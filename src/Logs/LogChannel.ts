import * as vscode from "vscode";
import { getWorkspaceFolder } from "../env";

export interface LogChannelInterface {
    name: string;
    debug(value: string): void;
    info(value: string): void;
    warning(value: string): void;
    error(value: string): void;
    critical(value: string): void;

    get logLevel(): string;
}

function logConfigLevel() {
    return vscode.workspace
        .getConfiguration("vscode-ios", getWorkspaceFolder())
        .get<string>("log.level");
}

// Proxy class to wrap vscode.OutputChannel
export class LogChannel implements vscode.OutputChannel, LogChannelInterface {
    logChannel: vscode.OutputChannel;
    mode: vscode.ExtensionMode = vscode.ExtensionMode.Production;

    constructor(channelName: string) {
        this.logChannel = vscode.window.createOutputChannel(channelName);
        this.name = channelName;
    }

    // in debug build the log level is always debug
    debug(value: string): void {
        if (logConfigLevel() === "debug" || this.mode !== vscode.ExtensionMode.Production) {
            this.appendLine(`[DEBUG] ${value}`);
        }
    }
    info(value: string): void {
        if (
            ["debug", "info"].includes(logConfigLevel() || "") ||
            this.mode !== vscode.ExtensionMode.Production
        ) {
            this.appendLine(`[INFO] ${value}`);
        }
    }
    warning(value: string): void {
        if (
            ["debug", "info", "warning"].includes(logConfigLevel() || "") ||
            this.mode !== vscode.ExtensionMode.Production
        ) {
            this.appendLine(`[WARNING] ${value}`);
        }
    }
    error(value: string): void {
        if (
            ["debug", "info", "warning", "error"].includes(logConfigLevel() || "") ||
            this.mode !== vscode.ExtensionMode.Production
        ) {
            this.appendLine(`[ERROR] ${value}`);
        }
    }
    critical(value: string): void {
        this.appendLine(`[CRITICAL] ${value}`);
    }

    get logLevel(): string {
        if (this.mode !== vscode.ExtensionMode.Production) {
            return "debug";
        }
        return logConfigLevel() || "info";
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
