import * as vscode from "vscode";
import { ProblemDiagnosticResolver } from "../ProblemDiagnosticResolver";
import { buildSelectedTarget } from "../buildCommands";
import { runAndDebugTests, runApp } from "../commands";
import { Executor, ExecutorMode } from "../Executor";
import { CommandContext } from "../CommandManagement/CommandContext";
import { askIfBuild } from "../inputPicker";
import {
    DebugConfigurationContextBinderType,
    DebugConfigurationProvider,
} from "./DebugConfigurationProvider";
import * as fs from "fs";
import { getFilePathInWorkspace } from "../env";
import { SimulatorFocus } from "./SimulatorFocus";
import { killSpawnLaunchedProcesses } from "../utils";
import { LogChannelInterface } from "../Logs/LogChannel";

export class DebugAdapterTracker implements vscode.DebugAdapterTracker {
    private debugSession: vscode.DebugSession;
    private problemResolver: ProblemDiagnosticResolver;
    private isTerminated = false;
    private disList: vscode.Disposable[] = [];
    private simulatorInteractor: SimulatorFocus;

    private get sessionID(): string {
        return this.debugSession.configuration.sessionId;
    }
    private get deviceID(): string {
        return this.debugSession.configuration.deviceID;
    }
    private get testsToRun(): string[] {
        return this.debugSession.configuration.testsToRun || [];
    }
    private get xctestrun(): string {
        return this.debugSession.configuration.xctestrun;
    }
    private get isCoverage(): boolean {
        return this.debugSession.configuration.isCoverage;
    }
    private get processExe(): string {
        return this.debugSession.configuration.processExe;
    }
    private get context(): DebugConfigurationContextBinderType | undefined {
        return DebugConfigurationProvider.getContextForSession(this.sessionID);
    }

    private breakpoints: vscode.Breakpoint[] = [];

    private log?: LogChannelInterface;

    private get isDebuggable(): boolean {
        return this.debugSession.configuration.noDebug === true
            ? false
            : (this.debugSession.configuration.isDebuggable as boolean);
    }
    private _stream: fs.WriteStream;

    private unverifiedBreakpointDisposables?: vscode.Disposable;

    constructor(debugSession: vscode.DebugSession, problemResolver: ProblemDiagnosticResolver) {
        this.debugSession = debugSession;
        this.problemResolver = problemResolver;
        this._stream = fs.createWriteStream(getFilePathInWorkspace(this.logPath), { flags: "a+" });
        this.log = this.context?.commandContext.log;
        this.simulatorInteractor = new SimulatorFocus(this.log);
        this.unverifiedBreakpointDisposables = vscode.debug.onDidReceiveDebugSessionCustomEvent(
            e => {
                if (
                    e.event === "fixBreakpointsLocations" &&
                    e.session.id === this.debugSession.id
                ) {
                    this.log?.debug(
                        "Received fixBreakpoints event, refreshing breakpoints to work around lldb-dap issue"
                    );
                    this.syncUnverifiedBreakpoints(e.body);
                }
            }
        );
    }

    private get logPath(): string {
        return this.debugSession.configuration.logPath;
    }

    onWillStartSession() {
        this.breakpoints = [...vscode.debug.breakpoints];
        this.simulatorInteractor.init(this.context!.commandContext.projectEnv, this.processExe);
        this.log?.info("Debug session is starting...");
        vscode.debug.activeDebugSession;
        this.disList.push(
            this.context!.commandContext.debugConsoleEvent(std => {
                this._stream.write(std);
            })
        );
        this.disList.push(
            this.context!.commandContext.cancellationToken.onCancellationRequested(() => {
                this.terminateCurrentSession(false, false);
            })
        );
        this.build(this.debugSession.configuration);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onDidSendMessage(message: any) {
        // this.log?.debug(`Sent: ${JSON.stringify(message)}`);
        if (message.command === "continue") {
            if (this.debugSession.configuration.target !== "tests") {
                // for tests we don't focus simulator on continue as tests run quickly and focusing back and forth is annoying
                this.simulatorInteractor.focus();
            }
        }
    }

    private refreshBreakpoints = new Set<string>();

    private syncUnverifiedBreakpoints(message: { filePath: string; line: number }) {
        if (
            this.debugSession.configuration.type === DebugConfigurationProvider.RealLLDBTypeAdapter
        ) {
            // lldb-dap has an annoying bug when all breakpoints are not verified at start of app, just remove them and add them back solves the issue
            const sourcePath = message.filePath;

            if (this.refreshBreakpoints.has(sourcePath)) {
                return;
            }
            this.refreshBreakpoints.add(sourcePath);

            const breakpoints = this.breakpoints;
            let breakpointFound = false;
            for (const bp of breakpoints) {
                if (
                    bp instanceof vscode.SourceBreakpoint &&
                    bp.location.uri.fsPath === message.filePath
                ) {
                    breakpointFound = true;
                    break;
                }
            }
            if (breakpointFound) {
                const dummyBp = new vscode.SourceBreakpoint(
                    new vscode.Location(
                        vscode.Uri.file(message.filePath),
                        new vscode.Position(0, 0)
                    ),
                    true
                );
                vscode.debug.addBreakpoints([dummyBp]);
                vscode.debug.removeBreakpoints([dummyBp]);
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onWillReceiveMessage(message: any) {
        // this.log?.debug(`Received: ${JSON.stringify(message)}`);
        if (
            message.command === "disconnect" &&
            (message.arguments === undefined || message.arguments.terminateDebuggee === true)
        ) {
            this.terminateCurrentSession(true, false);
        }
    }

    onWillStopSession() {
        this.log?.info("Debug session is stopping...");
        this.unverifiedBreakpointDisposables?.dispose();
        if (this.debugSession.configuration.target === "app") {
            this.terminateCurrentSession(true, true);
        }
    }

    onError(error: Error) {
        this.log?.error(`Error: ${error.message}`);
    }

    onExit(code: number | undefined, signal: string | undefined) {
        this.log?.info(`Exited with code ${code} and signal ${signal}`);
    }

    private async terminateCurrentSession(isCancelled: boolean, isStop: boolean) {
        if (this.isTerminated) {
            return;
        }
        try {
            this.disList.forEach(dis => dis.dispose());
            this.disList = [];
            this.unverifiedBreakpointDisposables?.dispose();
            this._stream.close();
            this.isTerminated = true;
            await DebugAdapterTracker.updateStatus(this.sessionID, "stopped");
        } finally {
            try {
                killSpawnLaunchedProcesses(this.deviceID);
                if (isCancelled) {
                    this.context?.commandContext.cancel();
                }
            } catch {
                /* empty */
            } finally {
                if (isStop) {
                    await vscode.debug.stopDebugging(this.debugSession);
                } else {
                    this.debugSession.customRequest("disconnect");
                }
            }
        }
    }

    public static async updateStatus(sessionId: string, status: string) {
        await new Executor().execShell({
            scriptOrCommand: { file: "update_debugger_launching.py" },
            args: [sessionId, status],
            mode: ExecutorMode.none,
        });
    }

    private async executeAppCommand(
        buildCommand: ((commandContext: CommandContext) => Promise<void>) | undefined,
        runCommandClosure: (commandContext: CommandContext) => Promise<void>
    ) {
        if (
            buildCommand !== undefined &&
            (await this.checkBuildBeforeLaunch(this.debugSession.configuration))
        ) {
            await DebugAdapterTracker.updateStatus(this.sessionID, "building");
            this.context!.commandContext.terminal!.terminalName = `Building for ${this.isDebuggable ? "Debug" : "Run"}`;
            await buildCommand(this.context!.commandContext);
        }
        await DebugAdapterTracker.updateStatus(this.sessionID, "launching");
        await runCommandClosure(this.context!.commandContext);
    }

    private async checkBuildBeforeLaunch(dbgConfig: vscode.DebugConfiguration) {
        const deviceID = await this.context!.commandContext.projectEnv.debugDeviceID;
        const exe = await this.context!.commandContext.projectEnv.appExecutablePath(deviceID);
        if (!fs.existsSync(exe)) {
            return true;
        }
        const buildBeforeLaunch = dbgConfig.buildBeforeLaunch || "always";
        switch (buildBeforeLaunch) {
            case "ask":
                return await askIfBuild();
            case "never":
                return false;
            default:
                return true;
        }
    }

    async build(dbgConfig: vscode.DebugConfiguration) {
        try {
            const isDebuggable = this.isDebuggable;
            if (dbgConfig.target === "app") {
                await this.executeAppCommand(
                    async context => {
                        await buildSelectedTarget(context, this.problemResolver);
                    },
                    async context => {
                        context.terminal!.terminalName = `Launching For ${this.isDebuggable ? "Debug" : "Run"}`;
                        await runApp(
                            context,
                            this.sessionID,
                            isDebuggable,
                            dbgConfig.args || [],
                            dbgConfig.env || {}
                        );
                    }
                );
            } else if (dbgConfig.target === "tests") {
                await this.executeAppCommand(undefined, async context => {
                    context.terminal!.terminalName = `Testing: ${this.isDebuggable ? "Debug" : "Run"}`;
                    await runAndDebugTests(
                        context,
                        this.sessionID,
                        isDebuggable,
                        this.testsToRun,
                        this.xctestrun,
                        this.isCoverage
                    );
                });
            }

            this.context!.token.fire();
            if (dbgConfig.target !== "app") {
                try {
                    await this.terminateCurrentSession(false, true);
                } catch {
                    /* empty */
                }
            }
        } catch (error) {
            this.context?.rejectToken.fire(error);
            await this.terminateCurrentSession(false, true);
        }
    }
}
