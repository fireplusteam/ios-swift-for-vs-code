import * as vscode from "vscode";

// Proxy class to wrap vscode.OutputChannel
export class LogChannel implements vscode.OutputChannel {
    logChannel: vscode.OutputChannel;
    mode: vscode.ExtensionMode = vscode.ExtensionMode.Production;

    constructor(channelName: string) {
        this.logChannel = vscode.window.createOutputChannel(channelName);
        this.name = channelName;
    }

    name: string;

    append(value: string): void {
        this.logChannel.append(value);
    }

    appendLine(value: string): void {
        this.logChannel.appendLine(value);

        if (this.mode !== vscode.ExtensionMode.Production) {
            console.log(value);
        }
    }

    replace(value: string): void {
        this.logChannel.replace(value);
    }

    clear(): void {
        this.logChannel.clear();
    }

    show(column?: unknown, preserveFocus?: boolean): void {
        this.logChannel.show(preserveFocus);
    }

    hide(): void {
        this.logChannel.hide();
    }

    dispose(): void {
        this.logChannel.dispose();
    }
}
