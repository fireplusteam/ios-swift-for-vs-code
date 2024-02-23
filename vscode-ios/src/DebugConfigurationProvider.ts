import * as vscode from "vscode";
import { Executor } from "./execShell";
import { getScriptPath, isActivated } from "./env";
import { commandWrapper } from "./commandWrapper";
import { runAndDebugTests, runAndDebugTestsForCurrentFile, runApp, runAppAndDebug as runAppForDebug } from "./commands";
import { buildSelectedTarget, buildTests, buildTestsForCurrentFile } from "./build";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";

class ErrorDuringPreLaunchTask extends Error {
    public constructor(message: string) {
        super(message);
    }
}
export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {

    static Type = "xcode-lldb";
    static lldbName = "iOS App Debugger NAME UNIQUE RANDOM";

    private executor: Executor;
    private problemResolver: ProblemDiagnosticResolver;

    private disposable: vscode.Disposable[] = [];
    private isRunning = false;

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
                    this.isRunning = false;
                }
                this.activeSession = undefined;
            }
        }));

        this.disposable.push(vscode.commands.registerCommand("vscode-ios.stop.debug.session", (e) => {
            if (this.isRunning && vscode.debug.activeDebugSession === undefined) {
                this.executor.terminateShell();
                this.isRunning = false;
            } else {
                vscode.debug.stopDebugging(this.activeSession);
            }
        }));
    }

    private async executeAppCommand(syncCommand: () => Promise<void>, asyncCommandClosure: () => Promise<void>) {
        try {
            this.isRunning = true;
            await commandWrapper(syncCommand);
            await this.setEnvVariables();
            commandWrapper(asyncCommandClosure);
            this.isRunning = false;
        } catch (err) {
            await this.stopOnError();
            throw err;
        }
    }

    private async stopOnError() {
        await vscode.debug.stopDebugging(this.activeSession);
        this.isRunning = false;
        this.activeSession = undefined;
    }

    public startIOSDebugger() {
        let debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "iOS: APP Debug",
            request: "launch",
            target: "app"
        };
        vscode.debug.startDebugging(undefined, debugSession);
    }

    public startIOSTestsDebugger() {
        let debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "iOS: APP Debug",
            request: "launch",
            target: "tests"
        };
        vscode.debug.startDebugging(undefined, debugSession);
    }

    public startIOSTestsForCurrentFileDebugger() {
        let debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "iOS: APP Debug",
            request: "launch",
            target: "testsForCurrentFile"
        };
        vscode.debug.startDebugging(undefined, debugSession);
    }

    async setEnvVariables() { 
        await this.executor.execShell("Debugger Launching", "debugger_launching.sh");
    }

    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        if (!isActivated()) {
            return null;
        }
        if (dbgConfig.type !== DebugConfigurationProvider.Type) {
            return null;
        }
        try {
            if (dbgConfig.target === "app") {
                await this.executeAppCommand(async () => {
                    await buildSelectedTarget(this.executor, this.problemResolver);
                }, async () => {
                    await runAppForDebug(this.executor);
                });
            } else if(dbgConfig.target === "tests") {
                await this.executeAppCommand(async () => {
                    await buildTests(this.executor, this.problemResolver);
                }, async () => {
                    await runAndDebugTests(this.executor);
                });
            } else if (dbgConfig.target === "testsForCurrentFile") {
                await this.executeAppCommand(async () => {
                    await buildTestsForCurrentFile(this.executor, this.problemResolver);
                }, async () => {
                    await runAndDebugTestsForCurrentFile(this.executor);
                });
            }
        } catch {
            return null;
        }

        return this.debugSession();
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
                "command script add -f attach_lldb.app_log app_log",
                //`target create ${getScriptPath()}/lldb_exe_stub`,  // TODO: experiment with this              
                "create_target",
            ],
            processCreateCommands: [
                "process handle SIGKILL -n true -p true -s false",
                "process handle SIGTERM -n true -p true -s false",
                "watch_new_process",
            ],
            exitCommands: []
        };
        return debugSession;
    }
}