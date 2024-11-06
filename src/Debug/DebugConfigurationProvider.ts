import * as vscode from "vscode";
import {
    getScriptPath,
    getWorkspaceFolder,
    getWorkspacePath,
    isActivated,
    ProjectFileMissedError,
} from "../env";
import { emptyAppLog, getSessionId } from "../utils";
import { RuntimeWarningsLogWatcher } from "../XcodeSideTreePanel/RuntimeWarningsLogWatcher";
import { LLDBDapDescriptorFactory } from "./LLDBDapDescriptorFactory";
import { DebugAdapterTracker } from "./DebugAdapterTracker";
import { AtomicCommand } from "../CommandManagement/AtomicCommand";
import { CommandContext, UserTerminatedError } from "../CommandManagement/CommandContext";
import { checkWorkspace } from "../commands";
import { XCTestRunInspector } from "./XCTestRunInspector";
import path from "path";

function runtimeWarningsConfigStatus() {
    return vscode.workspace
        .getConfiguration("vscode-ios", getWorkspaceFolder())
        .get<string>("swiftui.runtimeWarnings");
}

function runtimeWarningBreakPointCommand() {
    switch (runtimeWarningsConfigStatus()) {
        case "report":
            return "breakpoint set --name os_log_fault_default_callback --command printRuntimeWarning --command continue";
        case "breakpoint":
            return "breakpoint set --name os_log_fault_default_callback --command printRuntimeWarning";
        default:
            return undefined;
    }
}

export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    static Type = "xcode-lldb";
    static lldbName = "Xcode: App Debugger Console";

    private _counterID = 0;
    private get counterID(): number {
        this._counterID += 1;
        return this._counterID;
    }

    private static contextBinder = new Map<
        string,
        {
            commandContext: CommandContext;
            token: vscode.EventEmitter<void>;
            rejectToken: vscode.EventEmitter<unknown>;
        }
    >();
    public static getContextForSession(session: string) {
        return this.contextBinder.get(session);
    }

    constructor(
        private runtimeWarningsWatcher: RuntimeWarningsLogWatcher,
        private testRunInspector: XCTestRunInspector,
        private atomicCommand: AtomicCommand
    ) {}

    private waitForDebugSession(context: CommandContext, sessionID: string): Promise<void> {
        const operation = context.waitToCancel();
        DebugConfigurationProvider.contextBinder.set(sessionID, {
            commandContext: context,
            token: operation.token,
            rejectToken: operation.rejectToken,
        });
        return operation.wait.finally(() => {
            DebugConfigurationProvider.contextBinder.delete(sessionID);
        });
    }

    async startIOSDebugger(isDebuggable: boolean, context: CommandContext) {
        const sessionId = getSessionId(`App_${isDebuggable}${this.counterID}`);
        const debugSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "Xcode: Run App & Debug",
            request: "launch",
            target: "app",
            isDebuggable: isDebuggable,
            sessionId: sessionId,
        };

        const waiter = this.waitForDebugSession(context, sessionId);
        if ((await vscode.debug.startDebugging(undefined, debugSession)) === false) {
            context.cancel();
            return false;
        }
        await waiter;
        return true;
    }

    private async startParentSession(
        context: CommandContext,
        testRun: vscode.TestRun,
        isDebuggable: boolean
    ) {
        const sessionId = getSessionId(`All tests: ${isDebuggable}${this.counterID}`) + "_parent";
        const waiter = this.waitForDebugSession(context, sessionId);

        const parentSession: vscode.DebugConfiguration = {
            type: "xcode-lldb",
            name: "Xcode: Xcodebuild Tests",
            request: "launch",
            target: "parent",
            isDebuggable: isDebuggable,
            sessionId: sessionId,
        };

        const session = await new Promise<vscode.DebugSession>((resolve, reject) => {
            const dis: vscode.Disposable[] = [];
            dis.push(
                vscode.debug.onDidStartDebugSession(session => {
                    if (session.configuration.sessionId === parentSession.sessionId) {
                        dis.forEach(d => d.dispose());
                        resolve(session);
                    }
                })
            );
            dis.push(
                context.cancellationToken.onCancellationRequested(() => {
                    dis.forEach(d => d.dispose());
                    reject(UserTerminatedError);
                })
            );
            vscode.debug.startDebugging(undefined, parentSession).then(value => {
                if (value === false) {
                    dis.forEach(d => d.dispose());
                    reject(Error("Can not start parent session"));
                    context.cancel();
                }
            });
        });

        return { sessionWaiter: waiter, debugSession: session, sessionId: sessionId };
    }

    async startIOSTestsDebugger(
        tests: string[] | undefined,
        isDebuggable: boolean,
        testRun: vscode.TestRun,
        context: CommandContext,
        isCoverage: boolean
    ) {
        context.terminal!.terminalName = `Building for ${isDebuggable ? "Debug Tests" : "Run Tests"}`;

        const sessions = this.testRunInspector.build(context, tests, isCoverage);

        const parent = await this.startParentSession(context, testRun, isDebuggable);

        try {
            let wasErrorThrown: any | null = null;
            for (const session of await sessions) {
                const sessionId = getSessionId(`All tests: ${isDebuggable}${this.counterID}`);
                const testToRun =
                    tests === undefined
                        ? [session.target]
                        : tests.filter(test => test.split(path.sep).at(0) === session.target);
                if (testToRun.length === 0) {
                    continue;
                }
                const debugSession: vscode.DebugConfiguration = {
                    type: "xcode-lldb",
                    name: "Xcode: Run Tests & Debug",
                    request: "launch",
                    target: "tests",
                    isDebuggable: isDebuggable,
                    sessionId: sessionId,
                    testsToRun: testToRun,
                    buildBeforeLaunch: "never",
                    hostApp: session.host,
                    xctestrun: session.testRun,
                    isCoverage: isCoverage,
                };

                if (context.cancellationToken.isCancellationRequested) {
                    return false;
                }

                const waiter = this.waitForDebugSession(context, sessionId);
                if (
                    (await vscode.debug.startDebugging(undefined, debugSession, {
                        parentSession: parent.debugSession,
                        // lifecycleManagedByParent: true,
                    })) === false
                ) {
                    context.cancel();
                    return false;
                }
                try {
                    await waiter;
                } catch (error) {
                    if (
                        typeof error === "object" &&
                        error &&
                        "code" in error &&
                        error.code === 65
                    ) {
                        // code 65 means that xcodebuild found failed tests. However we want to continue running all
                        wasErrorThrown = error;
                    } else {
                        throw error;
                    }
                    console.log(error);
                }
            }
            if (wasErrorThrown) {
                throw wasErrorThrown;
            }
        } finally {
            if (parent) {
                DebugConfigurationProvider.getContextForSession(parent.sessionId)?.token.fire();
                await parent.sessionWaiter;
                DebugAdapterTracker.updateStatus(parent.sessionId, "stopped");
            }
        }
        return true;
    }

    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        dbgConfig: vscode.DebugConfiguration,
        token: vscode.CancellationToken
    ) {
        if ((await isActivated()) === false) {
            throw ProjectFileMissedError;
        }
        if (dbgConfig.type !== DebugConfigurationProvider.Type) {
            return null;
        }

        const isDebuggable =
            dbgConfig.noDebug === true ? false : (dbgConfig.isDebuggable as boolean);

        const sessionID =
            dbgConfig.sessionId === undefined
                ? getSessionId(`debugger`) + this.counterID
                : dbgConfig.sessionId;

        let context = DebugConfigurationProvider.getContextForSession(sessionID)?.commandContext;
        if (context === undefined) {
            context = await new Promise<CommandContext>((resolve, reject) => {
                this.atomicCommand
                    .userCommand(async commandContext => {
                        const waiter = this.waitForDebugSession(commandContext, sessionID);
                        resolve(commandContext);
                        await waiter;
                    }, "Start Debug")
                    .catch(reason => reject(reason));
            });
        }

        const disposableDebug = token.onCancellationRequested(() => {
            disposableDebug.dispose();
            context.cancel();
        });

        try {
            if (token.isCancellationRequested) {
                throw UserTerminatedError;
            }
            await checkWorkspace(context);
            await DebugAdapterTracker.updateStatus(sessionID, "configuring");
            if (dbgConfig.target !== "parent" && dbgConfig.target !== "tests") {
                if (
                    runtimeWarningsConfigStatus() !== "off" &&
                    (await context.projectEnv.debugDeviceID).platform !== "macOS"
                ) {
                    // mac OS doesn't support that feature at the moment
                    await this.runtimeWarningsWatcher.startWatcher();
                }
            }
        } catch (error) {
            context.cancel();
            return null;
        }

        return await this.debugSession(context, dbgConfig, sessionID, isDebuggable);
    }

    private async processName(context: CommandContext, exe: string) {
        let process_name = exe.split(path.sep).at(-1);
        if (process_name?.endsWith(".app")) {
            process_name = process_name.slice(0, -".app".length);
        }
        if ((await context.projectEnv.debugDeviceID).platform === "macOS") {
            return `${process_name}.app/Contents/MacOS/${process_name}`;
        }
        // if process_name == "xctest":
        //     return process_name
        return `${process_name}.app/${process_name}`;
    }

    private async debugSession(
        context: CommandContext,
        dbgConfig: vscode.DebugConfiguration,
        sessionID: string,
        isDebuggable: boolean
    ): Promise<vscode.DebugConfiguration> {
        if (dbgConfig.target === "parent") {
            return {
                name: dbgConfig.name,
                type: "debugpy",
                request: "launch",
                program: `${getScriptPath()}/parent_xcodebuild.py`,
                stopOnEntry: false,
                args: [sessionID],
                console: "internalConsole",
                internalConsoleOptions: "neverOpen",
                cwd: getWorkspacePath(),
                sessionId: sessionID,
                target: "parent",
            };
        }
        const lldExePath = await LLDBDapDescriptorFactory.getXcodeDebuggerExePath();
        const lldbCommands = dbgConfig.lldbCommands || [];
        const command = runtimeWarningBreakPointCommand();
        if (command && isDebuggable) {
            lldbCommands.push(command);
        }
        if (dbgConfig.target !== "app") {
            // for running tests, we don't need to listen to those process handler as it's redundant
            lldbCommands.push("process handle SIGKILL -n true -p true -s false");
            lldbCommands.push("process handle SIGTERM -n true -p true -s false");
        }

        // TODO: try to refactor launch logic
        // https://junch.github.io/debug/2016/09/19/original-lldb.html
        const deviceID = await context.projectEnv.debugDeviceID;
        const exe = dbgConfig.hostApp
            ? dbgConfig.hostApp
            : await context.projectEnv.appExecutablePath(deviceID);
        const processExe = await this.processName(context, exe);

        const logId = deviceID.id;
        emptyAppLog(logId);

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

                    `set_environmental_var PROJECT_SCHEME=!!=${await context.projectEnv.projectScheme}`,
                    `set_environmental_var DEVICE_ID=!!=${deviceID.id}`,
                    `set_environmental_var PLATFORM=!!=${deviceID.platform}`,
                    `set_environmental_var APP_EXE=!!=${exe}`,
                    `set_environmental_var PROCESS_EXE=!!=${processExe}`,

                    `create_target ${sessionID}`,

                    ...lldbCommands,
                    `setScriptPath ${getScriptPath()}`,
                    `watch_new_process ${sessionID} lldb-dap`,
                ],
                args: [],
                env: [],
                initCommands: [],
                exitCommands: [],
                cwd: getWorkspacePath(),
                debuggerRoot: getWorkspacePath(),
                stopOnEntry: false,
                sessionId: sessionID,
                noDebug: !isDebuggable,
                target: dbgConfig.target,
                testsToRun: dbgConfig.testsToRun,
                buildBeforeLaunch: dbgConfig.buildBeforeLaunch,
                logPath: `.logs/app_${logId}.log`,
                deviceID: deviceID.id,
                xctestrun: dbgConfig.xctestrun,
                isCoverage: dbgConfig.isCoverage,
            };
            return debugSession;
        } else {
            // old code-lldb way: deprecated
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

                    `set_environmental_var PROJECT_SCHEME=!!=${await context.projectEnv.projectScheme}`,
                    `set_environmental_var DEVICE_ID=!!=${deviceID.id}`,
                    `set_environmental_var PLATFORM=!!=${deviceID.platform}`,
                    `set_environmental_var APP_EXE=!!=${exe}`,
                    `set_environmental_var PROCESS_EXE=!!=${processExe}`,

                    `create_target ${sessionID}`,
                ],
                processCreateCommands: [
                    ...lldbCommands,
                    `setScriptPath ${getScriptPath()}`,
                    `watch_new_process ${sessionID} codelldb`,
                    "continue",
                ],
                exitCommands: [],
                sessionId: sessionID,
                noDebug: !isDebuggable,
                target: dbgConfig.target,
                testsToRun: dbgConfig.testsToRun,
                buildBeforeLaunch: dbgConfig.buildBeforeLaunch,
                logPath: `.logs/app_${logId}.log`,
                deviceID: deviceID.id,
                xctestrun: dbgConfig.xctestrun,
                isCoverage: dbgConfig.isCoverage,
            };
            return debugSession;
        }
    }
}
