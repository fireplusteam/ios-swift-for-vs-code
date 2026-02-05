import * as vscode from "vscode";
import { LogChannelInterface } from "../Logs/LogChannel";

export class InteractiveTerminal {
    private terminal: vscode.Terminal;
    private log: LogChannelInterface;
    private closeDisposal: vscode.Disposable;
    private onDidEndTerminalShellExecutionDisposal: vscode.Disposable | undefined;
    private commands: Map<string, (event: vscode.TerminalShellExecutionEndEvent) => Promise<void>> =
        new Map();

    private async shellIntegration(): Promise<vscode.TerminalShellIntegration> {
        return new Promise(resolve => {
            if (this.terminal.shellIntegration !== undefined) {
                resolve(this.terminal.shellIntegration);
                return;
            }
            let disposal: vscode.Disposable | undefined = undefined;
            disposal = vscode.window.onDidChangeTerminalShellIntegration(eventShellCreated => {
                if (eventShellCreated.terminal !== this.terminal) {
                    return;
                }
                resolve(eventShellCreated.shellIntegration);
                disposal?.dispose();
                disposal = undefined;
            });
            this.onDidEndTerminalShellExecutionDisposal =
                vscode.window.onDidEndTerminalShellExecution(event => {
                    this.log.info(`Terminal shell execution ended: ${event.execution.commandLine}`);
                    this.commands.get(event.execution.commandLine.value)?.(event);
                });
        });
    }

    constructor(log: LogChannelInterface, name: string) {
        this.log = log;
        let existingTerminal: vscode.Terminal | undefined = undefined;
        vscode.window.terminals.forEach(terminal => {
            if (terminal.name === name) {
                existingTerminal = terminal;
            }
        });
        if (existingTerminal === undefined) {
            this.terminal = vscode.window.createTerminal({ name: name, hideFromUser: true });
        } else {
            this.terminal = existingTerminal;
        }
        this.closeDisposal = vscode.window.onDidCloseTerminal(event => {
            if (event === this.terminal) {
                this.terminal = vscode.window.createTerminal({ name: name, hideFromUser: true });
            }
        });
    }

    show() {
        this.terminal.show();
    }

    async executeCommand(installScript: string): Promise<void> {
        this.log.info(`Executing command in terminal: ${installScript}`);
        return new Promise(async (resolver, reject) => {
            try {
                let dispose: vscode.Disposable | undefined = undefined;
                const localTerminal = this.terminal;
                let closeDisposal: vscode.Disposable | undefined;
                this.commands.set(
                    installScript,
                    async (event: vscode.TerminalShellExecutionEndEvent) => {
                        try {
                            for await (const data of event.execution.read()) {
                                this.log.info(data);
                            }
                            if (event.exitCode === 0) {
                                this.log.info("Successfully installed");
                                resolver();
                            } else {
                                this.log.error(`Is not installed, error: ${event.exitCode}`);
                                reject(event.exitCode);
                            }
                        } catch (err) {
                            reject(err);
                        } finally {
                            dispose?.dispose();
                            dispose = undefined;
                            closeDisposal?.dispose();
                            closeDisposal = undefined;
                        }
                    }
                );
                closeDisposal = vscode.window.onDidCloseTerminal(event => {
                    if (event === localTerminal) {
                        this.log.info(`Terminal is Closed`);
                        closeDisposal?.dispose();
                        closeDisposal = undefined;
                        dispose?.dispose();
                        dispose = undefined;
                        reject(Error("Terminal is closed"));
                    }
                });
                (await this.shellIntegration()).executeCommand(installScript);
            } catch (err) {
                this.log.error(`Error executing command ${installScript} with error: ${err}`);
                reject(err);
            }
        });
    }
}
