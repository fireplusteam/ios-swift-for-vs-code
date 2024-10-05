import * as vscode from "vscode";

export class SwiftOutputChannel implements vscode.OutputChannel {
    name: string = "Xcode Swift LSP";

    append(value: string): void {
        console.log(`${this.name}: ${value}`);
    }

    appendLine(value: string): void {
        console.log(`${this.name}: ${value}`);
    }

    replace(value: string): void {
        console.log(`${this.name} replace: ${value}`);
    }

    clear(): void {
    }

    show(column?: unknown, preserveFocus?: unknown): void {
    }

    hide(): void {
    }

    dispose(): void {
    }
}