import { exec } from "child_process";
import * as vscode from "vscode";

class DebugAdapterTracker implements vscode.DebugAdapterTracker {
    private debugSession: vscode.DebugSession;

    constructor(debugSession: vscode.DebugSession) {
        this.debugSession = debugSession;
    }

    onWillStartSession() {
        console.log('Session is starting');
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
    }
}

export class DebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
    createDebugAdapterTracker(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        if ((session.type === 'xcode-lldb' || session.type === 'lldb') && session.configuration.sessionId) {
            return new DebugAdapterTracker(session);
        }
    }
}