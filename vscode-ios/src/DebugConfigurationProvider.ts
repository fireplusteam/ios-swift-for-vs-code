import * as vscode from "vscode";
import { CancellationToken } from "vscode";
import { Executor } from "./execShell";
import { getScriptPath, isActivated } from "./env";
import { commandWrapper } from "./commandWrapper";
import { runApp, runAppAndDebug } from "./commands";
import { resolve } from "path";
import { BuildTaskProvider } from "./BuildTaskProvider";
import { debug } from "console";
import { buildSelectedTarget } from "./build";

export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {

    static Type = "xcode-lldb";

    private executor: Executor;

    private onDidTerminateDisposable: vscode.Disposable;
    private onDidStartDisposable: vscode.Disposable;
    private isRunning = false;

    private activeSession: vscode.DebugSession | undefined;

    constructor(executor: Executor) {
        this.executor = executor;
        this.onDidStartDisposable = vscode.debug.onDidStartDebugSession((e) => {
            if (e.name === "iOS App Debug") {
                this.activeSession = e;
            }
        });
        this.onDidTerminateDisposable = vscode.debug.onDidTerminateDebugSession((e) => {
            if (e.id === this.activeSession?.id) {
                if (this.isRunning) {
                    this.executor.terminateShell();
                }
                this.activeSession = undefined;
            }
        });
    }

    private async executeAppCommand() {
        try {
            this.isRunning = true;
            await commandWrapper(async () => {
                await runAppAndDebug(this.executor, true);
            });
            this.isRunning = false;
        } catch (err) {
            await vscode.debug.stopDebugging(this.activeSession);
            this.isRunning = false;
        }
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

    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        if (dbgConfig.type !== DebugConfigurationProvider.Type) {
            return null;
        }
        if (dbgConfig.target === "app") {
            this.executeAppCommand();
        }

        return this.debugSession();
    }

    private debugSession(): vscode.DebugConfiguration {
        let debugSession: vscode.DebugConfiguration = {
            type: "lldb",
            request: "custom",
            name: "iOS App Debug",
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