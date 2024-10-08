import * as vscode from "vscode";

export class InteractiveTerminal {
    private terminal: vscode.Terminal;
    private log: vscode.OutputChannel;
    private closeDisposal: vscode.Disposable;

    private async shellIntegration(): Promise<vscode.TerminalShellIntegration> {
        return new Promise(resolve => {
            if (this.terminal.shellIntegration !== undefined) {
                resolve(this.terminal.shellIntegration);
                return;
            }
            let disposal: vscode.Disposable | undefined = undefined;
            disposal = vscode.window.onDidChangeTerminalShellIntegration(eventShellCreated => {
                if (eventShellCreated.terminal !== this.terminal)
                    return;
                resolve(eventShellCreated.shellIntegration);
                disposal?.dispose();
                disposal = undefined;
            });
        });
    }

    constructor(log: vscode.OutputChannel, name: string) {
        this.log = log;
        this.terminal = vscode.window.createTerminal({ name: name, hideFromUser: true });
        this.closeDisposal = vscode.window.onDidCloseTerminal((event) => {
            if (event === this.terminal) {
                this.terminal = vscode.window.createTerminal({ name: name, hideFromUser: true });
            }
        });
    }

    show() {
        this.terminal.show();
    }

    async executeCommand(installScript: string): Promise<void> {
        this.log.appendLine(installScript);
        return new Promise(async (resolver, reject) => {
            try {
                const command = (await this.shellIntegration()).executeCommand(installScript);
                let dispose: vscode.Disposable | undefined = undefined;
                const localTerminal = this.terminal;
                dispose = vscode.window.onDidEndTerminalShellExecution(async (event) => {
                    if (command === event.execution) {
                        for await (const data of event.execution.read()) {
                            this.log.append(data);
                        }
                        if (event.exitCode === 0) {
                            this.log.appendLine("Successfully installed");
                            resolver();
                        } else {
                            this.log.appendLine(`Is not installed, error: ${event.exitCode}`);
                            reject(event.exitCode);
                        }
                        dispose?.dispose();
                        dispose = undefined;
                    }
                });
                let closeDisposal: vscode.Disposable | undefined;
                closeDisposal = vscode.window.onDidCloseTerminal((event) => {
                    if (event === localTerminal) {
                        this.log.appendLine(`Terminal is Closed`);
                        closeDisposal?.dispose();
                        closeDisposal = undefined;
                        reject(new Error("Terminal is closed"));
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }
}