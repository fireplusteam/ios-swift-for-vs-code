import * as vscode from "vscode";
import { Executor } from "../execShell";
import { Platform, currentPlatform, getBuildRootPath, getDeviceId, getProjectConfiguration, getProjectScheme, getScriptPath, getWorkspacePath, isActivated } from "../env";
import { runAndDebugTests, runAndDebugTestsForCurrentFile, runApp, terminateCurrentIOSApp } from "../commands";
import { buildSelectedTarget, buildTests, buildTestsForCurrentFile } from "../buildCommands";
import { ProblemDiagnosticResolver } from "../ProblemDiagnosticResolver";
import { getSessionId } from "../utils";
import { sleep } from "../extension";
import path from "path";
import { AtomicCommand } from "../AtomicCommand";
import { RuntimeWarningsLogWatcher } from "../XcodeSideTreePanel/RuntimeWarningsLogWatcher";
import { LLDBDapDescriptorFactory } from "./LLDBDapDescriptorFactory";

export class TerminatedDebugSessionTask extends Error {
    public constructor(message: string) {
        super(message);
    }
}

function runtimeWarningsConfigStatus() {
    return vscode.workspace.getConfiguration("vscode-ios").get<string>("swiftui.runtimeWarnings");
}

function runtimeWarningBreakPointCommand() {
    switch (runtimeWarningsConfigStatus()) {
        case "report":
            return "breakpoint set --name os_log_fault_default_callback --command printRuntimeWarning --command continue";
        case "breakpoint":
            return "breakpoint set --name os_log_fault_default_callback --command printRuntimeWarning";
        default: return undefined;
    }
}

export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {

    static Type = "xcode-lldb";
    static lldbName = "iOS: App Debugger Console";

    private problemResolver: ProblemDiagnosticResolver;

    private disposable: vscode.Disposable[] = [];
    private isRunning = false;
    private sessionID = getSessionId("debugger");
    private counter = 0;
    private testsToRun: string[] | undefined;
    private atomicCommand: AtomicCommand;
    private runtimeWarningsWatcher: RuntimeWarningsLogWatcher;

    private debugTestSessionEvent = new vscode.EventEmitter<string>();

    private setIsRunning(value: boolean) {
        this.isRunning = value;
        vscode.commands.executeCommand("setContext", "VSCode_iOS_debugStarted", value);
    }

    private activeSession: vscode.DebugSession | undefined;

    constructor(problemResolver: ProblemDiagnosticResolver, runtimeWarningsWatcher: RuntimeWarningsLogWatcher, atomicCommand: AtomicCommand) {
        this.problemResolver = problemResolver;
        this.runtimeWarningsWatcher = runtimeWarningsWatcher;
        this.atomicCommand = atomicCommand;
        this.disposable.push(vscode.debug.onDidStartDebugSession((e) => {
            if (e.configuration.sessionId === this.sessionID) {
                if (this.activeSession !== undefined) {
                    vscode.debug.stopDebugging(this.activeSession);
                }
                this.activeSession = e;
            }
        }));
        this.disposable.push(vscode.debug.onDidTerminateDebugSession(async (e) => {
            if (e.id === this.activeSession?.id && this.isRunning) {
                // for tests, it's automatically freed, so no need to terminate it manually
                if (e.configuration.target === 'app')
                    await this.atomicCommand.executor.terminateShell();
                this.setIsRunning(false);
                await this.terminateCurrentSession();
                this.activeSession = undefined;
            }
        }));

        this.disposable.push(vscode.commands.registerCommand("vscode-ios.stop.debug.session", async (e) => {
            await this.atomicCommand.executor.terminateShell();
            this.setIsRunning(false);
            await this.terminateCurrentSession();
            this.activeSession = undefined;
        }));
    }

    public async terminateCurrentSession() {
        await terminateCurrentIOSApp(this.sessionID, new Executor(), true);
    }

    private async executeAppCommand(buildCommand: () => Promise<void>, runCommandClosure: () => Promise<void>, successMessage: string | undefined = undefined) {
        try {
            await this.terminateCurrentSessionIfNeeded();

            this.setIsRunning(true);
            await this.atomicCommand.userCommand(buildCommand);

            await this.terminateCurrentSession();
            await this.setEnvVariables();
            this.atomicCommand.userCommand(runCommandClosure, successMessage).catch(e => {
                console.log(`Running ended with : ${e}`);
            });
        } catch (err) {
            const message = (err as Error).message;
            if (message !== "Debug session" && message != "Debug Task") {
                this.setIsRunning(false);
                await this.stop();
            }
            throw err;
        }
    }

    private async stop() {
        if (this.isRunning) {
            await this.atomicCommand.executor.terminateShell(new TerminatedDebugSessionTask("Debug Task"));
            await this.terminateCurrentSession();
        }
        if (this.activeSession !== undefined)
            await vscode.debug.stopDebugging(this.activeSession);
        this.activeSession = undefined;
        this.setIsRunning(false);
    }

    private async shouldAskForTerminateCurrentSession() {
        const isEnabled = vscode.workspace.getConfiguration("vscode-ios").get("confirm.restart");
        if (!isEnabled) {
            return false;
        }
        return true;
    }

    private async terminateCurrentSessionIfNeeded() {
        if (this.isRunning) {
            const option = (await this.shouldAskForTerminateCurrentSession()) ? await vscode.window.showErrorMessage("Terminate the current session?", "Yes", "No") : "Yes";
            if (option === "Yes") {
                try {
                    await this.stop();
                }
                catch { }
                console.log("ok");
                await sleep(1500);
            } else {
                throw new TerminatedDebugSessionTask("Debug session");
            }
        }
    }

    async startIOSDebugger(isDebuggable: boolean) {
        const appSessionId = getSessionId(`App_${isDebuggable}`);
        let debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "iOS: Run App & Debug",
            request: "launch",
            target: "app",
            isDebuggable: isDebuggable,
            appSessionId: appSessionId
        };

        if (await vscode.debug.startDebugging(undefined, debugSession) == false) {
            return false;
        } else {
            let dis: vscode.Disposable | undefined;
            return await new Promise<boolean>(resolve => {
                dis = vscode.debug.onDidTerminateDebugSession(e => {
                    if (e.configuration.appSessionId === appSessionId)
                        resolve(true);
                });
            });
        }
    }

    async startIOSTestsDebugger(isDebuggable: boolean) {
        const appSessionId = getSessionId(`All tests: ${isDebuggable}`);
        let debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "iOS: Run Tests & Debug",
            request: "launch",
            target: "tests",
            isDebuggable: isDebuggable,
            appSessionId: appSessionId
        };

        if (await vscode.debug.startDebugging(undefined, debugSession) == false) {
            return false;
        } else {
            let dis: vscode.Disposable | undefined;
            return await new Promise<boolean>(resolve => {
                dis = this.debugTestSessionEvent.event(e => {
                    if (e === appSessionId)
                        resolve(true);
                });
            });
        }
    }

    async startIOSTestsForCurrentFileDebugger(tests: string[], isDebuggable: boolean) {
        this.testsToRun = tests;
        const appSessionId = `${getSessionId(tests.join(","))}_${isDebuggable}`;
        let debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "iOS: Run Tests & Debug: Current File",
            request: "launch",
            target: "testsForCurrentFile",
            isDebuggable: isDebuggable,
            appSessionId: appSessionId
        };

        if (await vscode.debug.startDebugging(undefined, debugSession) == false) {
            return false;
        } else {
            let dis: vscode.Disposable | undefined;
            return await new Promise<boolean>(resolve => {
                dis = this.debugTestSessionEvent.event(e => {
                    if (e === appSessionId)
                        resolve(true);
                });
            });
        }
    }

    async setEnvVariables() {
        this.counter += 1;
        this.sessionID = getSessionId(`debugger`) + this.counter;
        await this.atomicCommand.userCommand(async () => {
            await this.atomicCommand.executor.execShell("Debugger Launching", "debugger_launching.sh", [this.sessionID]);
        });
    }

    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        if (!isActivated()) {
            return null;
        }
        if (dbgConfig.type !== DebugConfigurationProvider.Type) {
            return null;
        }
        const isDebuggable = dbgConfig.noDebug === true ? false : dbgConfig.isDebuggable as boolean;
        try {
            if (dbgConfig.target === "app") {
                await this.executeAppCommand(async () => {
                    await buildSelectedTarget(this.atomicCommand.executor, this.problemResolver);
                }, async () => {
                    if (currentPlatform() != Platform.macOS)
                        await runApp(this.sessionID, this.atomicCommand.executor, isDebuggable);
                });
            } else if (dbgConfig.target === "tests") {
                await this.executeAppCommand(async () => {
                    await buildTests(this.atomicCommand.executor, this.problemResolver);
                }, async () => {
                    try {
                        await runAndDebugTests(this.sessionID, this.atomicCommand.executor, isDebuggable);
                    } finally {
                        this.setIsRunning(false);
                        await this.terminateCurrentSession();
                        this.debugTestSessionEvent.fire(dbgConfig.appSessionId || this.sessionID);
                    }
                }, "All Tests Are Passed");
            } else if (dbgConfig.target === "testsForCurrentFile") {
                await this.executeAppCommand(async () => {
                    await buildTestsForCurrentFile(this.atomicCommand.executor, this.problemResolver, this.testsToRun || []);
                }, async () => {
                    try {
                        await runAndDebugTestsForCurrentFile(this.sessionID, this.atomicCommand.executor, isDebuggable, this.testsToRun || []);
                    } finally {
                        this.setIsRunning(false);
                        await this.terminateCurrentSession();
                        this.debugTestSessionEvent.fire(dbgConfig.appSessionId || this.sessionID);
                    }
                }, "All Tests Are Passed");
            }

            if (!dbgConfig.appSessionId)
                dbgConfig.appSessionId = this.sessionID;
        } catch {
            let debugSession: vscode.DebugConfiguration = {
                type: "xcode-lldb",
                request: "launch",
                name: DebugConfigurationProvider.lldbName,
                isDummy: true
            };
            return debugSession;
        }

        if (runtimeWarningsConfigStatus() !== "off")
            this.runtimeWarningsWatcher.startWatcher();

        return await this.debugSession(dbgConfig, isDebuggable);
    }

    private async debugSession(dbgConfig: vscode.DebugConfiguration, isDebuggable: boolean): Promise<vscode.DebugConfiguration> {
        // for macOS, use different scheme to app running
        const lldExePath = await LLDBDapDescriptorFactory.getXcodeDebuggerExePath();
        if (currentPlatform() == Platform.macOS && dbgConfig.target == "app") {
            if (lldExePath) {
                let debugSession: vscode.DebugConfiguration = {
                    "type": "xcode-lldb",
                    "request": "launch",
                    "name": DebugConfigurationProvider.lldbName,
                    "program": `${path.join(getBuildRootPath(), "Build", "Products", getProjectConfiguration(), `${getProjectScheme()}.app`)}`,
                    "cwd": path.join(getBuildRootPath(), "Build", "Products", getProjectConfiguration())
                };
                return debugSession;
            } else { // old code lldb way: deprecated
                let debugSession: vscode.DebugConfiguration = {
                    "type": "lldb",
                    "request": "launch",
                    "name": DebugConfigurationProvider.lldbName,
                    "program": `${path.join(getBuildRootPath(), "Build", "Products", getProjectConfiguration(), `${getProjectScheme()}.app`)}`,
                    "cwd": path.join(getBuildRootPath(), "Build", "Products", getProjectConfiguration())
                };
                return debugSession;
            }
        }
        const lldbCommands = dbgConfig.lldbCommands || [];
        const command = runtimeWarningBreakPointCommand();
        if (command && isDebuggable)
            lldbCommands.push(command);

        // TODO: try to refactor launch logic
        // https://junch.github.io/debug/2016/09/19/original-lldb.html
        if (lldExePath) {
            const debugSession: vscode.DebugConfiguration = {
                type: "xcode-lldb",
                request: "attach",
                name: DebugConfigurationProvider.lldbName,
                attachCommands: [
                    `command script import '${getScriptPath()}/attach_lldb.py'`,
                    "command script add -f attach_lldb.create_target create_target",
                    "command script add -f attach_lldb.terminate_debugger terminate_debugger",
                    "command script add -f attach_lldb.watch_new_process watch_new_process",
                    "command script add -f attach_lldb.setScriptPath setScriptPath",
                    "command script add -f attach_lldb.printRuntimeWarning printRuntimeWarning",
                    "command script add -f attach_lldb.app_log app_log",
                    "command script add -f attach_lldb.start_monitor simulator-focus-monitor",
                    `create_target ${this.sessionID}`,

                    ...lldbCommands,
                    //"process handle SIGKILL -n true -p true -s false",
                    //"process handle SIGTERM -n true -p true -s false",
                    `setScriptPath ${getScriptPath()}`,
                    `watch_new_process ${this.sessionID} lldb-dap`,
                ],
                args: [],
                env: [],
                initCommands: [

                ],
                exitCommands: [],
                cwd: getWorkspacePath(),
                debuggerRoot: getWorkspacePath(),
                stopOnEntry: false,
                appSessionId: dbgConfig.appSessionId,
                sessionId: this.sessionID,
                noDebug: !isDebuggable,
                target: dbgConfig.target
            };
            return debugSession;
        } else { // old code-lldb way: deprecated
            let debugSession: vscode.DebugConfiguration = {
                type: "lldb",
                request: "custom",
                name: DebugConfigurationProvider.lldbName,
                targetCreateCommands: [
                    `command script import '${getScriptPath()}/attach_lldb.py'`,
                    "command script add -f attach_lldb.create_target create_target",
                    "command script add -f attach_lldb.terminate_debugger terminate_debugger",
                    "command script add -f attach_lldb.watch_new_process watch_new_process",
                    "command script add -f attach_lldb.setScriptPath setScriptPath",
                    "command script add -f attach_lldb.printRuntimeWarning printRuntimeWarning",
                    "command script add -f attach_lldb.app_log app_log",
                    "command script add -f attach_lldb.start_monitor simulator-focus-monitor",
                    `create_target ${this.sessionID}`
                ],
                processCreateCommands: [
                    ...lldbCommands,
                    //"process handle SIGKILL -n true -p true -s false",
                    //"process handle SIGTERM -n true -p true -s false",
                    `setScriptPath ${getScriptPath()}`,
                    `watch_new_process ${this.sessionID} codelldb`
                ],
                exitCommands: [],
                appSessionId: dbgConfig.appSessionId,
                sessionId: this.sessionID,
                noDebug: !isDebuggable,
                target: dbgConfig.target
            };
            return debugSession;
        }
    }
}