import * as vscode from "vscode";
import { ProblemDiagnosticResolver } from "../ProblemDiagnosticResolver";
import { buildSelectedTarget, buildTests, buildTestsForCurrentFile } from "../buildCommands";
import { runAndDebugTests, runAndDebugTestsForCurrentFile, runApp } from "../commands";
import { Executor, ExecutorMode } from "../execShell";
import { CommandContext } from "../CommandManagement/CommandContext";
import { askIfBuild } from "../inputPicker";
import { DebugConfigurationProvider } from "./DebugConfigurationProvider";
import * as fs from 'fs'

export class DebugAdapterTracker implements vscode.DebugAdapterTracker {
    private debugSession: vscode.DebugSession;
    private problemResolver: ProblemDiagnosticResolver;
    private debugTestSessionEvent: vscode.EventEmitter<string>;
    private isTerminated = false;

    private get sessionID(): string {
        return this.debugSession.configuration.sessionId;
    }
    private get testsToRun(): string[] {
        return this.debugSession.configuration.testsToRun || [];
    }
    private get context(): CommandContext {
        return DebugConfigurationProvider.contextBinder.get(this.sessionID)!;
    }

    constructor(debugSession: vscode.DebugSession, problemResolver: ProblemDiagnosticResolver, debugTestSessionEvent: vscode.EventEmitter<string>) {
        this.debugSession = debugSession;
        this.problemResolver = problemResolver;
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
        } finally {
            try {
                this.context.cancel();
                await vscode.debug.stopDebugging(this.debugSession);
            } catch { }
            this.debugTestSessionEvent.fire(this.debugSession.configuration.appSessionId || this.sessionID);
        }
    }

    public static async updateStatus(sessionId: string, status: string) {
        await new Executor().execShell({
            scriptOrCommand: { file: "debugger_launching.sh" },
            args: [sessionId, status],
            mode: ExecutorMode.silently
        });
    }

    private async executeAppCommand(buildCommand: (commandContext: CommandContext) => Promise<void>, runCommandClosure: (commandContext: CommandContext) => Promise<void>, successMessage: string | undefined = undefined) {
        if (await this.checkBuildBeforeLaunch(this.debugSession.configuration)) {
            await DebugAdapterTracker.updateStatus(this.sessionID, "building");
            await buildCommand(this.context);
        }
        await DebugAdapterTracker.updateStatus(this.sessionID, "launching");
        await runCommandClosure(this.context);
    }

    private async checkBuildBeforeLaunch(dbgConfig: vscode.DebugConfiguration) {
        const exe = await (this.context.projectSettingsProvider.projectEnv.appExecutablePath);
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
        } catch (error) {
            console.log(error);
            await this.terminateCurrentSession();
        } finally {
            if (dbgConfig.target !== 'app') {
                await this.terminateCurrentSession();
            }
        }
    }
}