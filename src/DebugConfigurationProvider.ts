import * as vscode from "vscode";
import { Executor } from "./execShell";
import { getDeviceId, getEnvList, getScriptPath, isActivated } from "./env";
import { commandWrapper } from "./commandWrapper";
import { runAndDebugTests, runAndDebugTestsForCurrentFile, runApp, terminateCurrentIOSApp } from "./commands";
import { buildSelectedTarget, buildTests, buildTestsForCurrentFile } from "./buildCommands";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { getSessionId, killSpawnLaunchedProcesses } from "./utils";
import { sleep } from "./extension";
import { resolve } from "path";

export class TerminatedDebugSessionTask extends Error {
    public constructor(message: string) {
        super(message);
    }
}
export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {

    static Type = "xcode-lldb";
    static lldbName = "iOS: App Debugger Console";

    private executor: Executor;
    private problemResolver: ProblemDiagnosticResolver;

    private disposable: vscode.Disposable[] = [];
    private isRunning = false;
    private sessionID = getSessionId("debugger");
    private counter = 0;
    private testsToRun: string[] | undefined;

    private setIsRunning(value: boolean) {
        this.isRunning = value;
        vscode.commands.executeCommand("setContext", "VSCode_iOS_debugStarted", value);
    }

    private activeSession: vscode.DebugSession | undefined;

    constructor(executor: Executor, problemResolver: ProblemDiagnosticResolver) {
        this.executor = executor;
        this.problemResolver = problemResolver;
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
                await this.executor.terminateShell();
                this.setIsRunning(false);
                await terminateCurrentIOSApp(this.sessionID, new Executor(), true);
                this.activeSession = undefined;
            }
        }));

        this.disposable.push(vscode.commands.registerCommand("vscode-ios.stop.debug.session", async (e) => {
            await this.executor.terminateShell();
            this.setIsRunning(false);
            await terminateCurrentIOSApp(this.sessionID, new Executor(), true);
        }));
    }

    private async executeAppCommand(buildCommand: () => Promise<void>, runCommandClosure: () => Promise<void>, successMessage: string | undefined = undefined) {
        try {
            await this.terminateCurrentSessionIfNeeded();

            this.setIsRunning(true);
            await commandWrapper(buildCommand);

            await terminateCurrentIOSApp(this.sessionID, new Executor(), true);
            await this.setEnvVariables();
            commandWrapper(runCommandClosure, successMessage);
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
            await this.executor.terminateShell(new TerminatedDebugSessionTask("Debug Task"));
            await terminateCurrentIOSApp(this.sessionID, new Executor(), true);
        }
        if (this.activeSession !== undefined)
            await vscode.debug.stopDebugging(this.activeSession);
        this.activeSession = undefined;
        this.setIsRunning(false);
    }

    private async terminateCurrentSessionIfNeeded() {
        if (this.isRunning) {
            const option = await vscode.window.showErrorMessage("Terminate the current session?", "Yes", "No");
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
                dis = vscode.debug.onDidTerminateDebugSession(e => {
                    if (e.configuration.appSessionId === appSessionId)
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
                dis = vscode.debug.onDidTerminateDebugSession(e => {
                    if (e.configuration.appSessionId === appSessionId)
                        resolve(true);
                });
            });
        }
    }

    async setEnvVariables() {
        this.counter += 1;
        this.sessionID = getSessionId(`debugger`) + this.counter;
        await this.executor.execShell("Debugger Launching", "debugger_launching.sh", [this.sessionID]);
    }

    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        if (!isActivated()) {
            return null;
        }
        if (dbgConfig.type !== DebugConfigurationProvider.Type) {
            return null;
        }
        try {
            const isDebuggable = dbgConfig.noDebug === true ? false : dbgConfig.isDebuggable as boolean;
            const useCommandWrapper = dbgConfig.appSessionId === undefined;
            if (dbgConfig.target === "app") {
                await this.executeAppCommand(async () => {
                    await buildSelectedTarget(this.executor, this.problemResolver);
                }, async () => {
                    await runApp(this.sessionID, this.executor, isDebuggable);
                });
            } else if (dbgConfig.target === "tests") {
                await this.executeAppCommand(async () => {
                    await buildTests(this.executor, this.problemResolver);
                }, async () => {
                    try {
                        await runAndDebugTests(this.sessionID, this.executor, isDebuggable);
                    } finally {
                        this.setIsRunning(false);
                        await terminateCurrentIOSApp(this.sessionID, new Executor(), true);
                    }
                }, "All Tests Are Passed");
            } else if (dbgConfig.target === "testsForCurrentFile") {
                await this.executeAppCommand(async () => {
                    await buildTestsForCurrentFile(this.executor, this.problemResolver, this.testsToRun || []);
                }, async () => {
                    try {
                        await runAndDebugTestsForCurrentFile(this.sessionID, this.executor,isDebuggable, this.testsToRun || []);
                    } finally {
                        this.setIsRunning(false);
                        await terminateCurrentIOSApp(this.sessionID, new Executor(), true);
                    }
                }, "All Tests Are Passed");
            }

            if (!dbgConfig.appSessionId)
                dbgConfig.appSessionId = this.sessionID;

            if (isDebuggable === false) {
                return this.runSession(dbgConfig.appSessionId);
            }
        } catch {
            return null;
        }

        return this.debugSession(dbgConfig.appSessionId);
    }

    private runSession(appSessionId: string): vscode.DebugConfiguration {
        return {
            name: "iOS App Log",
            type: "debugpy",
            request: "launch",
            program: `${getScriptPath()}/app_log.py`,
            stopOnEntry: false,
            args: [
                `.logs/app_${getDeviceId()}.log`,
                this.sessionID
            ],
            console: "internalConsole",
            internalConsoleOptions: "neverOpen",
            envFile: "${workspaceFolder}/.vscode/.env",
            cwd: "${workspaceFolder}",
            appSessionId: appSessionId,
            sessionId: this.sessionID
        };
    }

    private debugSession(appSessionId: string): vscode.DebugConfiguration {
        let debugSession: vscode.DebugConfiguration = {
            type: "lldb",
            request: "custom",
            name: DebugConfigurationProvider.lldbName,
            program: "${workspaceFolder}/your-program.js",
            targetCreateCommands: [
                `command script import '${getScriptPath()}/attach_lldb.py'`,
                "command script add -f attach_lldb.create_target create_target",
                "command script add -f attach_lldb.terminate_debugger terminate_debugger",
                "command script add -f attach_lldb.watch_new_process watch_new_process",
                "command script add -f attach_lldb.setScriptPath setScriptPath",
                "command script add -f attach_lldb.app_log app_log",
                "command script add -f attach_lldb.start_monitor simulator-focus-monitor",
                `create_target ${this.sessionID}`
            ],
            processCreateCommands: [
                //"process handle SIGKILL -n true -p true -s false",
                //"process handle SIGTERM -n true -p true -s false",
                `setScriptPath ${getScriptPath()}`,
                `watch_new_process ${this.sessionID}`
            ],
            exitCommands: [],
            appSessionId: appSessionId,
            sessionId: this.sessionID
        };
        return debugSession;
    }
}