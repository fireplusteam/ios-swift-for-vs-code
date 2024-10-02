import * as vscode from "vscode";
import { ProblemDiagnosticResolver } from "../ProblemDiagnosticResolver";
import { AtomicCommand } from "../CommandManagement/AtomicCommand";
import { DebugAdapterTracker } from "./DebugAdapterTracker";

export class DebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
    private problemResolver: ProblemDiagnosticResolver;
    private debugTestSessionEvent: vscode.EventEmitter<string>;

    constructor(problemResolver: ProblemDiagnosticResolver, debugTestSessionEvent: vscode.EventEmitter<string>) {
        this.problemResolver = problemResolver;
        this.debugTestSessionEvent = debugTestSessionEvent;
    }

    createDebugAdapterTracker(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        if ((session.type === 'xcode-lldb' || session.type === 'lldb') && session.configuration.sessionId) {
            return new DebugAdapterTracker(session, this.problemResolver, this.debugTestSessionEvent);
        }
    }
}