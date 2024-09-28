import * as vscode from "vscode";
import { Platform, currentPlatform, getBuildRootPath, getDeviceId, getProjectConfiguration, getProjectScheme, getScriptPath, getWorkspacePath, isActivated } from "../env";
import { getSessionId } from "../utils";
import path from "path";
import { RuntimeWarningsLogWatcher } from "../XcodeSideTreePanel/RuntimeWarningsLogWatcher";
import { LLDBDapDescriptorFactory } from "./LLDBDapDescriptorFactory";
import { DebugAdapterTracker } from "./DebugAdapterTrackerFactory";
import { count } from "console";

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

    private sessionID = getSessionId("debugger");
    private _counterID = 0;
    private get counterID(): number {
        this._counterID += 1;
        return this._counterID;
    }
    private runtimeWarningsWatcher: RuntimeWarningsLogWatcher;

    private debugTestSessionEvent: vscode.EventEmitter<string>;

    constructor(runtimeWarningsWatcher: RuntimeWarningsLogWatcher, debugTestSessionEvent: vscode.EventEmitter<string>) {
        this.runtimeWarningsWatcher = runtimeWarningsWatcher;
        this.debugTestSessionEvent = debugTestSessionEvent;
    }

    async startIOSDebugger(isDebuggable: boolean) {
        const appSessionId = getSessionId(`App_${isDebuggable}${this.counterID}`);
        let debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "iOS: Run App & Debug",
            request: "launch",
            target: "app",
            isDebuggable: isDebuggable,
            appSessionId: appSessionId
        };

        let dis: vscode.Disposable | undefined;
        return await new Promise<boolean>(resolve => {
            dis = this.debugTestSessionEvent.event(e => {
                if (e === appSessionId)
                    resolve(true);
            });
            vscode.debug.startDebugging(undefined, debugSession);
        });
    }

    async startIOSTestsDebugger(isDebuggable: boolean) {
        const appSessionId = getSessionId(`All tests: ${isDebuggable}${this.counterID}`);
        let debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "iOS: Run Tests & Debug",
            request: "launch",
            target: "tests",
            isDebuggable: isDebuggable,
            appSessionId: appSessionId
        };

        let dis: vscode.Disposable | undefined;
        return await new Promise<boolean>(resolve => {
            dis = this.debugTestSessionEvent.event(e => {
                if (e === appSessionId)
                    resolve(true);
            });
            vscode.debug.startDebugging(undefined, debugSession);
        });
    }

    async startIOSTestsForCurrentFileDebugger(tests: string[], isDebuggable: boolean) {
        const appSessionId = `${getSessionId(tests.join(","))}_${isDebuggable}${this.counterID}`;
        let debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "iOS: Run Tests & Debug: Current File",
            request: "launch",
            target: "testsForCurrentFile",
            isDebuggable: isDebuggable,
            appSessionId: appSessionId,
            testsToRun: tests
        };

        let dis: vscode.Disposable | undefined;
        return await new Promise<boolean>(resolve => {
            dis = this.debugTestSessionEvent.event(e => {
                if (e === appSessionId)
                    resolve(true);
            });
            vscode.debug.startDebugging(undefined, debugSession);
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

        this.sessionID = getSessionId(`debugger`) + this.counterID;
        await DebugAdapterTracker.updateStatus(this.sessionID, "configuring");

        if (runtimeWarningsConfigStatus() !== "off")
            this.runtimeWarningsWatcher.startWatcher();


        return await this.debugSession(dbgConfig, isDebuggable);
    }

    private async debugSession(dbgConfig: vscode.DebugConfiguration, isDebuggable: boolean): Promise<vscode.DebugConfiguration> {
        const lldExePath = await LLDBDapDescriptorFactory.getXcodeDebuggerExePath();
        const lldbCommands = dbgConfig.lldbCommands || [];
        const command = runtimeWarningBreakPointCommand();
        if (command && isDebuggable)
            lldbCommands.push(command);
        if (dbgConfig.target !== 'app') { // for running tests, we don't need to listen to those process handler as it's redundant
            lldbCommands.push("process handle SIGKILL -n true -p true -s false");
            lldbCommands.push("process handle SIGTERM -n true -p true -s false");
        }

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
                target: dbgConfig.target,
                testsToRun: dbgConfig.testsToRun
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
                target: dbgConfig.target,
                testsToRun: dbgConfig.testsToRun,
            };
            return debugSession;
        }
    }
}