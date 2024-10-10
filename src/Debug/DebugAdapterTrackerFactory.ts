import * as vscode from "vscode";
import { ProblemDiagnosticResolver } from "../ProblemDiagnosticResolver";
import { DebugAdapterTracker } from "./DebugAdapterTracker";

export class DebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
    private problemResolver: ProblemDiagnosticResolver;

    constructor(problemResolver: ProblemDiagnosticResolver) {
        this.problemResolver = problemResolver;
    }

    createDebugAdapterTracker(
        session: vscode.DebugSession
    ): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        if (
            (session.type === "xcode-lldb" || session.type === "lldb") &&
            session.configuration.sessionId
        ) {
            return new DebugAdapterTracker(session, this.problemResolver);
        }
    }
}
