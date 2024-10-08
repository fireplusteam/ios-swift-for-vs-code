import * as vscode from "vscode";
import { currentPlatform, getScriptPath, getWorkspacePath, isActivated, Platform, ProjectFileMissedError } from "../env";
import { emptyAppLog, getSessionId } from "../utils";
import { RuntimeWarningsLogWatcher } from "../XcodeSideTreePanel/RuntimeWarningsLogWatcher";
import { LLDBDapDescriptorFactory } from "./LLDBDapDescriptorFactory";
import { DebugAdapterTracker } from "./DebugAdapterTracker";
import { AtomicCommand } from "../CommandManagement/AtomicCommand";
import { CommandContext, UserTerminatedError } from "../CommandManagement/CommandContext";
import { checkWorkspace } from "../commands";

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

    private _counterID = 0;
    private get counterID(): number {
        this._counterID += 1;
        return this._counterID;
    }
    private runtimeWarningsWatcher: RuntimeWarningsLogWatcher;

    private debugTestSessionEvent: vscode.Event<string>;
    private atomicCommand: AtomicCommand;

    private static contextBinder = new Map<string, { commandContext: CommandContext, token: vscode.EventEmitter<void>, rejectToken: vscode.EventEmitter<unknown> }>();
    public static getContextForSession(session: string) {
        return this.contextBinder.get(session);
    }

    constructor(runtimeWarningsWatcher: RuntimeWarningsLogWatcher, atomicCommand: AtomicCommand, debugTestSessionEvent: vscode.Event<string>) {
        this.runtimeWarningsWatcher = runtimeWarningsWatcher;
        this.debugTestSessionEvent = debugTestSessionEvent;
        this.atomicCommand = atomicCommand;
    }

    async startIOSDebugger(isDebuggable: boolean) {
        const appSessionId = getSessionId(`App_${isDebuggable}${this.counterID}`);
        const debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "iOS: Run App & Debug",
            request: "launch",
            target: "app",
            isDebuggable: isDebuggable,
            appSessionId: appSessionId
        };

        let dis: vscode.Disposable | undefined;
        return await new Promise<boolean>(resolve => {
            dis = this.debugTestSessionEvent(e => {
                if (e === appSessionId) {
                    dis?.dispose();
                    resolve(true);
                }
            });
            vscode.debug.startDebugging(undefined, debugSession);
        });
    }

    async startIOSTestsDebugger(isDebuggable: boolean, testRun: vscode.TestRun) {
        const appSessionId = getSessionId(`All tests: ${isDebuggable}${this.counterID}`);
        const debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "iOS: Run Tests & Debug",
            request: "launch",
            target: "tests",
            isDebuggable: isDebuggable,
            appSessionId: appSessionId
        };

        let dis: vscode.Disposable | undefined;
        return await new Promise<boolean>(resolve => {
            dis = this.debugTestSessionEvent(e => {
                if (e === appSessionId) {
                    dis?.dispose();
                    resolve(true);
                }
            });
            vscode.debug.startDebugging(undefined, debugSession, { testRun: testRun });
        });
    }

    async startIOSTestsForCurrentFileDebugger(tests: string[], isDebuggable: boolean, testRun: vscode.TestRun) {
        const appSessionId = `${getSessionId(tests.join(","))}_${isDebuggable}${this.counterID}`;
        const debugSession: vscode.DebugConfiguration = {
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
            dis = this.debugTestSessionEvent(e => {
                if (e === appSessionId) {
                    dis?.dispose();
                    resolve(true);
                }
            });
            vscode.debug.startDebugging(undefined, debugSession, { testRun: testRun });
        });
    }

    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        if (await isActivated() === false) {
            throw ProjectFileMissedError;
        }
        if (dbgConfig.type !== DebugConfigurationProvider.Type) {
            return null;
        }
        const isDebuggable = dbgConfig.noDebug === true ? false : dbgConfig.isDebuggable as boolean;

        const sessionID = getSessionId(`debugger`) + this.counterID;

        const context = await new Promise<CommandContext>((resolve, reject) => {
            this.atomicCommand.userCommand(async (context: CommandContext) => {
                try {
                    if (token.isCancellationRequested) {
                        throw UserTerminatedError;
                    }
                    const disposableDebug = token.onCancellationRequested(() => {
                        disposableDebug.dispose();
                        context.cancel();
                    });
                    await checkWorkspace(context);
                    await DebugAdapterTracker.updateStatus(sessionID, "configuring");

                    if (runtimeWarningsConfigStatus() !== "off" && await currentPlatform() !== Platform.macOS) // mac OS doesn't support that feature at the moment
                        this.runtimeWarningsWatcher.startWatcher();

                    resolve(context);
                    try {
                        const operation = context.waitToCancel();
                        DebugConfigurationProvider.contextBinder.set(sessionID, { commandContext: context, token: operation.token, rejectToken: operation.rejectToken });
                        await operation.wait;
                    } finally {
                        DebugConfigurationProvider.contextBinder.delete(sessionID);
                    }
                } catch (error) {
                    reject(error);
                    throw error;
                }
            }, "Start Debug");
        });

        return await this.debugSession(context, dbgConfig, sessionID, isDebuggable);
    }

    private async processName(context: CommandContext) {
        const process_name = await context.projectSettingsProvider.projectEnv.productName;
        if (await context.projectSettingsProvider.projectEnv.platform === Platform.macOS) {
            return `${process_name}.app/Contents/MacOS/${process_name}`;
        }
        // if process_name == "xctest":
        //     return process_name
        return `${process_name}.app/${process_name}`;
    }

    private async debugSession(context: CommandContext, dbgConfig: vscode.DebugConfiguration, sessionID: string, isDebuggable: boolean): Promise<vscode.DebugConfiguration> {
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
        const exe = await context.projectSettingsProvider.projectEnv.appExecutablePath;

        const logId = await context.projectSettingsProvider.projectEnv.platform === Platform.macOS ? "MAC_OS" : await context.projectSettingsProvider.projectEnv.debugDeviceID;

        emptyAppLog(logId);

        const deviceID = await context.projectSettingsProvider.projectEnv.debugDeviceID;

        if (lldExePath) {
            const debugSession: vscode.DebugConfiguration = {
                type: "xcode-lldb",
                request: "attach",
                name: DebugConfigurationProvider.lldbName,
                attachCommands: [
                    `command script import '${getScriptPath()}/attach_lldb.py'`,
                    "command script add -f attach_lldb.set_environmental_var set_environmental_var",
                    "command script add -f attach_lldb.create_target create_target",
                    "command script add -f attach_lldb.terminate_debugger terminate_debugger",
                    "command script add -f attach_lldb.watch_new_process watch_new_process",
                    "command script add -f attach_lldb.setScriptPath setScriptPath",
                    "command script add -f attach_lldb.printRuntimeWarning printRuntimeWarning",
                    "command script add -f attach_lldb.app_log app_log",

                    `set_environmental_var PROJECT_SCHEME=!!=${await context.projectSettingsProvider.projectEnv.projectScheme}`,
                    `set_environmental_var DEVICE_ID=!!=${deviceID}`,
                    `set_environmental_var PLATFORM=!!=${await context.projectSettingsProvider.projectEnv.platformString}`,
                    `set_environmental_var PRODUCT_NAME=!!=${await context.projectSettingsProvider.projectEnv.productName}`,
                    `set_environmental_var APP_EXE=!!=${exe}`,
                    `set_environmental_var PROCESS_EXE=!!=${await this.processName(context)}`,

                    `create_target ${sessionID}`,

                    ...lldbCommands,
                    `setScriptPath ${getScriptPath()}`,
                    `watch_new_process ${sessionID} lldb-dap`,
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
                sessionId: sessionID,
                noDebug: !isDebuggable,
                target: dbgConfig.target,
                testsToRun: dbgConfig.testsToRun,
                buildBeforeLaunch: dbgConfig.buildBeforeLaunch,
                logPath: `.logs/app_${logId}.log`,
                deviceID: deviceID
            };
            return debugSession;
        } else { // old code-lldb way: deprecated
            const debugSession: vscode.DebugConfiguration = {
                type: "lldb",
                request: "custom",
                name: DebugConfigurationProvider.lldbName,
                targetCreateCommands: [
                    `command script import '${getScriptPath()}/attach_lldb.py'`,
                    "command script add -f attach_lldb.set_environmental_var set_environmental_var",
                    "command script add -f attach_lldb.create_target create_target",
                    "command script add -f attach_lldb.terminate_debugger terminate_debugger",
                    "command script add -f attach_lldb.watch_new_process watch_new_process",
                    "command script add -f attach_lldb.setScriptPath setScriptPath",
                    "command script add -f attach_lldb.printRuntimeWarning printRuntimeWarning",
                    "command script add -f attach_lldb.app_log app_log",

                    `set_environmental_var PROJECT_SCHEME=!!=${await context.projectSettingsProvider.projectEnv.projectScheme}`,
                    `set_environmental_var DEVICE_ID=!!=${deviceID}`,
                    `set_environmental_var PLATFORM=!!=${await context.projectSettingsProvider.projectEnv.platformString}`,
                    `set_environmental_var PRODUCT_NAME=!!=${await context.projectSettingsProvider.projectEnv.productName}`,
                    `set_environmental_var APP_EXE=!!=${exe}`,
                    `set_environmental_var PROCESS_EXE=!!=${await this.processName(context)}`,

                    `create_target ${sessionID}`
                ],
                processCreateCommands: [
                    ...lldbCommands,
                    `setScriptPath ${getScriptPath()}`,
                    `watch_new_process ${sessionID} codelldb`,
                    "continue"
                ],
                exitCommands: [],
                appSessionId: dbgConfig.appSessionId,
                sessionId: sessionID,
                noDebug: !isDebuggable,
                target: dbgConfig.target,
                testsToRun: dbgConfig.testsToRun,
                buildBeforeLaunch: dbgConfig.buildBeforeLaunch,
                logPath: `.logs/app_${logId}.log`,
                deviceID: deviceID
            };
            return debugSession;
        }
    }
}