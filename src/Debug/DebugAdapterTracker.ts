import * as vscode from "vscode";
import { ProblemDiagnosticResolver } from "../ProblemDiagnosticResolver";
import { AtomicCommand } from "../CommandManagement/AtomicCommand";
import { buildSelectedTarget, buildTests, buildTestsForCurrentFile } from "../buildCommands";
import { runAndDebugTests, runAndDebugTestsForCurrentFile, runApp, terminateCurrentIOSApp } from "../commands";
import { error } from "console";
import { Executor, ExecutorMode, ExecutorReturnType } from "../execShell";
import { CommandContext } from "../CommandManagement/CommandContext";
import { askIfBuild } from "../inputPicker";

export class DebugAdapterTracker implements vscode.DebugAdapterTracker {
    private debugSession: vscode.DebugSession;
    private problemResolver: ProblemDiagnosticResolver;
    private atomicCommand: AtomicCommand;
    private debugTestSessionEvent: vscode.EventEmitter<string>;
    private isTerminated = false;
    private commandContext: CommandContext | undefined;

    private get sessionID(): string {
        return this.debugSession.configuration.sessionId;
    }
    private get testsToRun(): string[] {
        return this.debugSession.configuration.testsToRun || [];
    }

    constructor(debugSession: vscode.DebugSession, problemResolver: ProblemDiagnosticResolver, atomicCommand: AtomicCommand, debugTestSessionEvent: vscode.EventEmitter<string>) {
        this.debugSession = debugSession;
        this.problemResolver = problemResolver;
        this.atomicCommand = atomicCommand;
        this.debugTestSessionEvent = debugTestSessionEvent;
    }

    onWillStartSession() {
        console.log('Session is starting');
        this.build(this.debugSession.configuration);
    }

    onDidSendMessage(message: any) {
        // console.log('Sent:', message);
    }

    onWillReceiveMessage(message: any) {
        // console.log('Will receive:', message);
    }

    onWillStopSession() {
        console.log('Session will stop');
        if (this.debugSession.configuration.target === "app")
            this.terminateCurrentSession();
    }

    onError(error: Error) {
        console.log('Error:', error);
    }

    onExit(code: number | undefined, signal: string | undefined) {
        console.log(`Exited with code ${code} and signal ${signal}`);
    }

    private async terminateCurrentSession() {
        if (this.isTerminated)
            return
        try {
            this.isTerminated = true;
            await DebugAdapterTracker.updateStatus(this.sessionID, "stopped");
            const terminationContext = new CommandContext(new vscode.CancellationTokenSource(), new Executor());
            await terminateCurrentIOSApp(terminationContext, this.sessionID, true);
            this.commandContext?.cancel();
        } finally {
            try {
                await vscode.debug.stopDebugging(this.debugSession);
            } catch { }
            this.debugTestSessionEvent.fire(this.debugSession.configuration.appSessionId || this.sessionID);
        }
    }

    public static async updateStatus(sessionId: string, status: string) {
        await new Executor().execShell(
            undefined,
            "Debugger Launching",
            "debugger_launching.sh",
            [sessionId, status],
            false,
            ExecutorReturnType.statusCode,
            ExecutorMode.silently
        );
    }

    private async executeAppCommand(buildCommand: (commandContext: CommandContext) => Promise<void>, runCommandClosure: (commandContext: CommandContext) => Promise<void>, successMessage: string | undefined = undefined) {
        await this.atomicCommand.userCommand(async (context) => {
            this.commandContext = context;
            if (await this.checkBuildBeforeLaunch(this.debugSession.configuration)) {
                await DebugAdapterTracker.updateStatus(this.sessionID, "building");
                await buildCommand(context);
            }
            await DebugAdapterTracker.updateStatus(this.sessionID, "launching");
            await runCommandClosure(context);
        }, successMessage);
    }

    private async checkBuildBeforeLaunch(dbgConfig: vscode.DebugConfiguration) {
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
        const isDebuggable = dbgConfig.noDebug === true ? false : dbgConfig.isDebuggable as boolean;
        try {
            if (dbgConfig.target === "app") {
                await this.executeAppCommand(async (context) => {
                    await buildSelectedTarget(context, this.problemResolver);
                }, async (context) => {
                    await runApp(context, this.sessionID, isDebuggable);
                });
            } else if (dbgConfig.target === "tests") {
                await this.executeAppCommand(async (context) => {
                    await buildTests(context, this.problemResolver);
                }, async (context) => {
                    await runAndDebugTests(context, this.sessionID, isDebuggable);
                }, "All Tests Are Passed");
            } else if (dbgConfig.target === "testsForCurrentFile") {
                await this.executeAppCommand(async (context) => {
                    await buildTestsForCurrentFile(context, this.problemResolver, this.testsToRun);
                }, async (context) => {
                    await runAndDebugTestsForCurrentFile(context, this.sessionID, isDebuggable, this.testsToRun);
                }, "All Tests Are Passed");
            }
        } catch {
            console.log(error);
            await this.terminateCurrentSession();
        } finally {
            if (dbgConfig.target !== 'app') {
                await this.terminateCurrentSession();
            }
        }
    }
}