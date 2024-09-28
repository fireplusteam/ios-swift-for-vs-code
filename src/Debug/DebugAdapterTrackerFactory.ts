import * as vscode from "vscode";
import { ProblemDiagnosticResolver } from "../ProblemDiagnosticResolver";
import { AtomicCommand } from "../AtomicCommand";
import { DebugAdapterTracker } from "./DebugAdapterTracker";

export class DebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
    private problemResolver: ProblemDiagnosticResolver;
    private atomicCommand: AtomicCommand;
    private debugTestSessionEvent: vscode.EventEmitter<string>;
    private previousDebugSession?: vscode.DebugSession

    constructor(problemResolver: ProblemDiagnosticResolver, atomicCommand: AtomicCommand, debugTestSessionEvent: vscode.EventEmitter<string>) {
        this.problemResolver = problemResolver;
        this.atomicCommand = atomicCommand;
        this.debugTestSessionEvent = debugTestSessionEvent;
    }

    createDebugAdapterTracker(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        if ((session.type === 'xcode-lldb' || session.type === 'lldb') && session.configuration.sessionId) {
            if (this.previousDebugSession)
                vscode.debug.stopDebugging(this.previousDebugSession);
            this.previousDebugSession = session;
            return new DebugAdapterTracker(session, this.problemResolver, this.atomicCommand, this.debugTestSessionEvent);
        }
    }
}