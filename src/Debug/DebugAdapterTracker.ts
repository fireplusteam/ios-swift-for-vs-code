import * as vscode from "vscode";
import { ProblemDiagnosticResolver } from "../ProblemDiagnosticResolver";
import { buildSelectedTarget } from "../buildCommands";
import { runAndDebugTests, runApp } from "../commands";
import { Executor, ExecutorMode } from "../Executor";
import { CommandContext } from "../CommandManagement/CommandContext";
import { askIfBuild } from "../inputPicker";
import { DebugConfigurationProvider } from "./DebugConfigurationProvider";
import * as fs from "fs";
import { getFilePathInWorkspace } from "../env";
import { SimulatorFocus } from "./SimulatorFocus";
import { killSpawnLaunchedProcesses } from "../utils";

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
    private get context() {
        return DebugConfigurationProvider.getContextForSession(this.sessionID)!;
    }

    private get isDebuggable(): boolean {
        return this.debugSession.configuration.noDebug === true
            ? false
            : (this.debugSession.configuration.isDebuggable as boolean);
    }
    private _stream: fs.WriteStream;

    constructor(debugSession: vscode.DebugSession, problemResolver: ProblemDiagnosticResolver) {
        this.debugSession = debugSession;
        this.problemResolver = problemResolver;
        this._stream = fs.createWriteStream(getFilePathInWorkspace(this.logPath), { flags: "a+" });
        this.simulatorInteractor = new SimulatorFocus();
    }

    private get logPath(): string {
        return this.debugSession.configuration.logPath;
    }

    onWillStartSession() {
        this.simulatorInteractor.init(this.context.commandContext.projectEnv, this.processExe);
        console.log("Session is starting");
        vscode.debug.activeDebugSession;
        this.disList.push(
            this.context.commandContext.debugConsoleEvent(std => {
                this._stream.write(std);
            })
        );
        this.disList.push(
            this.context.commandContext.cancellationToken.onCancellationRequested(() => {
                this.terminateCurrentSession(false, false);
            })
        );
        this.build(this.debugSession.configuration);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onDidSendMessage(message: any) {
        // console.log('Sent:', message);
        if (message.command === "continue") {
            this.simulatorInteractor.focus();
        }
    }

    private refreshBreakpoints = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onWillReceiveMessage(message: any) {
        if (
            message.command === "disconnect" &&
            (message.arguments === undefined || message.arguments.terminateDebuggee === true)
        ) {
            this.terminateCurrentSession(true, false);
        } else if (message.command === "continue" && this.refreshBreakpoints === false) {
            // lldb-dap has an annoying bug when all breakpoints are not verified at start of app, just remove them and add them back solves the issue
            this.refreshBreakpoints = true;
            if (this.debugSession.configuration.type === "xcode-lldb") {
                const breakpoints = vscode.debug.breakpoints;
                vscode.debug.removeBreakpoints(breakpoints);
                vscode.debug.addBreakpoints(breakpoints);
            }
        }
    }

    onWillStopSession() {
        console.log("Session will stop");
        if (this.debugSession.configuration.target === "app") {
            this.terminateCurrentSession(true, true);
        }
    }

    onError(error: Error) {
        console.log("Error:", error);
    }

    onExit(code: number | undefined, signal: string | undefined) {
        console.log(`Exited with code ${code} and signal ${signal}`);
    }

    private async terminateCurrentSession(isCancelled: boolean, isStop: boolean) {
        if (this.isTerminated) {
            return;
        }
        try {
            this.disList.forEach(dis => dis.dispose());
            this.disList = [];
            this._stream.close();
            this.isTerminated = true;
            await DebugAdapterTracker.updateStatus(this.sessionID, "stopped");
        } finally {
            try {
                killSpawnLaunchedProcesses(this.deviceID);
                if (isCancelled) {
                    this.context.commandContext.cancel();
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
            this.context.commandContext.terminal!.terminalName = `Building for ${this.isDebuggable ? "Debug" : "Run"}`;
            await buildCommand(this.context.commandContext);
        }
        await DebugAdapterTracker.updateStatus(this.sessionID, "launching");
        await runCommandClosure(this.context.commandContext);
    }

    private async checkBuildBeforeLaunch(dbgConfig: vscode.DebugConfiguration) {
        const deviceID = await this.context.commandContext.projectEnv.debugDeviceID;
        const exe = await this.context.commandContext.projectEnv.appExecutablePath(deviceID);
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
                        this.context.commandContext.terminal!.terminalName = `Launching For ${this.isDebuggable ? "Debug" : "Run"}`;
                        await runApp(context, this.sessionID, isDebuggable);
                    }
                );
            } else if (dbgConfig.target === "tests") {
                await this.executeAppCommand(undefined, async context => {
                    this.context.commandContext.terminal!.terminalName = `Testing: ${this.isDebuggable ? "Debug" : "Run"}`;
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

            this.context.token.fire();
            if (dbgConfig.target !== "app") {
                try {
                    await this.terminateCurrentSession(false, true);
                } catch {
                    /* empty */
                }
            }
        } catch (error) {
            this.context.rejectToken.fire(error);
            await this.terminateCurrentSession(false, true);
        }
    }
}
