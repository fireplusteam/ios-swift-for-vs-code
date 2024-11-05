import * as vscode from "vscode";
import { DebugConfigurationProvider } from "./DebugConfigurationProvider";
import { DebugAdapterTracker } from "./DebugAdapterTracker";

export class ParentDebugAdapterTracker implements vscode.DebugAdapterTracker {
    private debugSession: vscode.DebugSession;
    private isTerminated = false;

    private get sessionID(): string {
        return this.debugSession.configuration.sessionId;
    }
    private get context() {
        return DebugConfigurationProvider.getContextForSession(this.sessionID)!;
    }

    constructor(debugSession: vscode.DebugSession) {
        this.debugSession = debugSession;
    }

    onWillStartSession() {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    onDidSendMessage(_message: any) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    onWillReceiveMessage(_message: any) {}

    onWillStopSession() {
        console.log("Session will stop");
        this.terminateCurrentSession();
    }

    onError(error: Error) {
        console.log("Error:", error);
    }

    onExit(code: number | undefined, signal: string | undefined) {
        console.log(`Exited with code ${code} and signal ${signal}`);
    }

    private async terminateCurrentSession() {
        if (this.isTerminated) {
            return;
        }
        try {
            this.isTerminated = true;
            await DebugAdapterTracker.updateStatus(this.sessionID, "stopped");
        } finally {
            try {
                this.context.commandContext.cancel();
            } catch {
                /* empty */
            }
        }
    }
}
