import * as vscode from "vscode";
import {
    DebugConfigurationContextBinderType,
    DebugConfigurationProvider,
} from "./DebugConfigurationProvider";
import { DebugAdapterTracker } from "./DebugAdapterTracker";
import { LogChannelInterface } from "../Logs/LogChannel";

export class ParentDebugAdapterTracker implements vscode.DebugAdapterTracker {
    private debugSession: vscode.DebugSession;
    private isTerminated = false;

    private get sessionID(): string {
        return this.debugSession.configuration.sessionId;
    }
    private get context(): DebugConfigurationContextBinderType | undefined {
        return DebugConfigurationProvider.getContextForSession(this.sessionID);
    }

    private log?: LogChannelInterface;

    private dis?: vscode.Disposable;

    constructor(debugSession: vscode.DebugSession) {
        this.debugSession = debugSession;
        this.log = this.context?.commandContext.log;
    }

    onWillStartSession() {
        try {
            this.dis = this.context!.commandContext.cancellationToken.onCancellationRequested(
                () => {
                    this.terminateCurrentSession();
                }
            );
        } catch {
            /* empty */
            this.terminateCurrentSession();
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    onDidSendMessage(_message: any) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    onWillReceiveMessage(_message: any) {}

    onWillStopSession() {
        this.log?.info("Parent session will stop");
        this.terminateCurrentSession();
    }

    onError(error: Error) {
        this.log?.error(`Error: ${error}`);
    }

    onExit(code: number | undefined, signal: string | undefined) {
        this.log?.info(`Parent Exited with code ${code} and signal ${signal}`);
    }

    private async terminateCurrentSession() {
        if (this.isTerminated) {
            return;
        }
        try {
            this.dis?.dispose();
            this.dis = undefined;
            this.isTerminated = true;
            await DebugAdapterTracker.updateStatus(this.sessionID, "stopped");
        } finally {
            try {
                this.context?.commandContext.cancel();
            } catch {
                /* empty */
            }
        }
    }
}
