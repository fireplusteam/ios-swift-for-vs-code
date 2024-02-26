import * as vscode from "vscode";
import { Executor } from "./execShell";
import { getScriptPath, isActivated } from "./env";
import { commandWrapper } from "./commandWrapper";
import { runAndDebugTests, runAndDebugTestsForCurrentFile, runApp, terminateCurrentIOSApp } from "./commands";
import { buildSelectedTarget, buildTests, buildTestsForCurrentFile } from "./build";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { getSessionId, killSpawnLaunchedProcesses } from "./utils";

class ErrorDuringPreLaunchTask extends Error {
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

    private setIsRunning(value: boolean) {
        this.isRunning = value;
        vscode.commands.executeCommand("setContext", "VSCode_iOS_debugStarted", value);
    }

    private activeSession: vscode.DebugSession | undefined;

    constructor(executor: Executor, problemResolver: ProblemDiagnosticResolver) {
        this.executor = executor;
        this.problemResolver = problemResolver;
        this.disposable.push(vscode.debug.onDidStartDebugSession((e) => {
            if (e.name === DebugConfigurationProvider.lldbName) {
                this.activeSession = e;
            }
        }));
        this.disposable.push(vscode.debug.onDidTerminateDebugSession((e) => {
            if (e.id === this.activeSession?.id) {
                if (this.isRunning) {
                    this.executor.terminateShell();
                    this.setIsRunning(false);
                    terminateCurrentIOSApp(this.sessionID, this.executor);
                }
                this.activeSession = undefined;
            }
        }));

        this.disposable.push(vscode.commands.registerCommand("vscode-ios.stop.debug.session", (e) => {
            this.executor.terminateShell();
            this.setIsRunning(false);
            vscode.debug.stopDebugging(this.activeSession);
            terminateCurrentIOSApp(this.sessionID, this.executor);
        }));
    }

    private async executeAppCommand(buildCommand: () => Promise<void>, runCommandClosure: () => Promise<void>, successMessage: string | undefined = undefined) {
        try {
            this.setIsRunning(true);
            await commandWrapper(buildCommand);
            await terminateCurrentIOSApp(this.sessionID, this.executor);
            await this.setEnvVariables();
            commandWrapper(runCommandClosure, successMessage);
            this.setIsRunning(false);
        } catch (err) {
            await this.stopOnError();
            throw err;
        }
    }

    private async stopOnError() {
        await vscode.debug.stopDebugging(this.activeSession);
        this.setIsRunning(false);
        this.activeSession = undefined;
    }

    async startIOSDebugger(isDebuggable: boolean) {
        let debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "iOS: APP Debug",
            request: "launch",
            target: "app",
            isDebuggable: isDebuggable
        };
        vscode.debug.startDebugging(undefined, debugSession);
    }

    async startIOSTestsDebugger(isDebuggable: boolean) {
        let debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "iOS: Tests Debug",
            request: "launch",
            target: "tests",
            isDebuggable: isDebuggable
        };
        vscode.debug.startDebugging(undefined, debugSession);
    }

    async startIOSTestsForCurrentFileDebugger(isDebuggable: boolean) {
        let debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "iOS: Tests Debug: Current File",
            request: "launch",
            target: "testsForCurrentFile",
            isDebuggable: isDebuggable
        };
        vscode.debug.startDebugging(undefined, debugSession);
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
            const isDebuggable = dbgConfig.isDebuggable as boolean;

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
                        await runAndDebugTests(this.sessionID, this.executor, this.problemResolver, isDebuggable);
                    } finally {
                        await terminateCurrentIOSApp(this.sessionID, this.executor);
                    }
                }, "All Tests Passed");
            } else if (dbgConfig.target === "testsForCurrentFile") {
                await this.executeAppCommand(async () => {
                    await buildTestsForCurrentFile(this.executor, this.problemResolver);
                }, async () => {
                    try {
                        await runAndDebugTestsForCurrentFile(this.sessionID, this.executor, this.problemResolver, isDebuggable);
                    } finally {
                        await terminateCurrentIOSApp(this.sessionID, this.executor);
                    }
                }, "All Tests Passed");
            }
            if (isDebuggable === false) {
                return this.runSession();
            }
        } catch {
            return null;
        }

        return this.debugSession();
    }

    private runSession(): vscode.DebugConfiguration {
        return {
            name: "iOS App Log",
            type: "debugpy",
            request: "launch",
            program: `${getScriptPath()}/app_log.py`,
            stopOnEntry: false,
            args: [
                ".logs/app.log",
                this.sessionID
            ],
            console: "internalConsole",
            internalConsoleOptions: "neverOpen",
            envFile: "${workspaceFolder}/.vscode/.env",
            cwd: "${workspaceFolder}"
        };
    }

    private debugSession(): vscode.DebugConfiguration {
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
                //`target create ${getScriptPath()}/lldb_exe_stub`,  // TODO: experiment with this              
                `create_target ${this.sessionID}`,
            ],
            processCreateCommands: [
                "process handle SIGKILL -n true -p true -s false",
                "process handle SIGTERM -n true -p true -s false",
                `setScriptPath ${getScriptPath()}`,
                `watch_new_process ${this.sessionID}`
            ],
            exitCommands: []
        };
        return debugSession;
    }
}