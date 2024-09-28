import * as vscode from "vscode";
import { ProblemDiagnosticResolver } from "../ProblemDiagnosticResolver";
import { AtomicCommand } from "../AtomicCommand";
import { buildSelectedTarget, buildTests, buildTestsForCurrentFile } from "../buildCommands";
import { currentPlatform, Platform } from "../env";
import { runAndDebugTests, runAndDebugTestsForCurrentFile, runApp, terminateCurrentIOSApp } from "../commands";
import { TerminatedDebugSessionTask } from "./DebugConfigurationProvider";
import { error } from "console";
import { Executor, ExecutorMode, ExecutorReturnType } from "../execShell";

export class DebugAdapterTracker implements vscode.DebugAdapterTracker {
    private debugSession: vscode.DebugSession;
    private problemResolver: ProblemDiagnosticResolver;
    private atomicCommand: AtomicCommand;
    private debugTestSessionEvent: vscode.EventEmitter<string>;
    private isTerminated = false;

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
        console.log('Sent:', message);
    }

    onWillReceiveMessage(message: any) {
        console.log('Will receive:', message);
    }

    onWillStopSession() {
        console.log('Session will stop');
    }

    onError(error: Error) {
        console.log('Error:', error);
    }

    onExit(code: number | undefined, signal: string | undefined) {
        console.log(`Exited with code ${code} and signal ${signal}`);
        if (this.debugSession.configuration.target === "app")
            this.terminateCurrentSession();
    }

    public async terminateCurrentSession() {
        if (this.isTerminated)
            return
        this.isTerminated = true;

        await DebugAdapterTracker.updateStatus(this.sessionID, "stopped");
        await this.atomicCommand.executor.terminateShell(new TerminatedDebugSessionTask("Debug Task"));
        await terminateCurrentIOSApp(this.sessionID, new Executor(), true);

        this.debugTestSessionEvent.fire(this.debugSession.configuration.appSessionId || this.sessionID);
    }

    public static async updateStatus(sessionId: string, status: string) {
        await new Executor().execShell(
            "Debugger Launching",
            "debugger_launching.sh",
            [sessionId, status],
            false,
            ExecutorReturnType.statusCode,
            ExecutorMode.silently
        );
    }

    private async executeAppCommand(buildCommand: () => Promise<void>, runCommandClosure: () => Promise<void>, successMessage: string | undefined = undefined) {
        try {
            await this.atomicCommand.userCommand(buildCommand);

            await DebugAdapterTracker.updateStatus(this.sessionID, "launching");
            await this.atomicCommand.userCommand(runCommandClosure, successMessage).catch(e => {
                console.log(`Running ended with : ${e}`);
            });
        } catch (err) {
            throw err;
        }
    }

    async build(dbgConfig: vscode.DebugConfiguration) {
        const isDebuggable = dbgConfig.noDebug === true ? false : dbgConfig.isDebuggable as boolean;
        try {
            await DebugAdapterTracker.updateStatus(this.sessionID, "building");
            if (dbgConfig.target === "app") {
                await this.executeAppCommand(async () => {
                    await buildSelectedTarget(this.atomicCommand.executor, this.problemResolver);
                }, async () => {
                    if (currentPlatform() != Platform.macOS)
                        await runApp(this.sessionID, this.atomicCommand.executor, isDebuggable);
                });
            } else if (dbgConfig.target === "tests") {
                await this.executeAppCommand(async () => {
                    await buildTests(this.atomicCommand.executor, this.problemResolver);
                }, async () => {
                    try {
                        await runAndDebugTests(this.sessionID, this.atomicCommand.executor, isDebuggable);
                    } finally {
                        await this.terminateCurrentSession();
                    }
                }, "All Tests Are Passed");
            } else if (dbgConfig.target === "testsForCurrentFile") {
                await this.executeAppCommand(async () => {
                    await buildTestsForCurrentFile(this.atomicCommand.executor, this.problemResolver, this.testsToRun);
                }, async () => {
                    try {
                        await runAndDebugTestsForCurrentFile(this.sessionID, this.atomicCommand.executor, isDebuggable, this.testsToRun);
                    } finally {
                        await this.terminateCurrentSession();
                    }
                }, "All Tests Are Passed");
            }
        } catch {
            console.log(error);
            await this.terminateCurrentSession();
        }
    }
}

export class DebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
    private problemResolver: ProblemDiagnosticResolver;
    private atomicCommand: AtomicCommand;
    private debugTestSessionEvent: vscode.EventEmitter<string>;

    constructor(problemResolver: ProblemDiagnosticResolver, atomicCommand: AtomicCommand, debugTestSessionEvent: vscode.EventEmitter<string>) {
        this.problemResolver = problemResolver;
        this.atomicCommand = atomicCommand;
        this.debugTestSessionEvent = debugTestSessionEvent;
    }

    createDebugAdapterTracker(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        if ((session.type === 'xcode-lldb' || session.type === 'lldb') && session.configuration.sessionId) {
            return new DebugAdapterTracker(session, this.problemResolver, this.atomicCommand, this.debugTestSessionEvent);
        }
    }
}