import * as vscode from "vscode";

export enum TerminalMessageStyle {
    default,
    success,
    command,
    error,
    warning,
}

export class TerminalShell {
    private writeEmitter: vscode.EventEmitter<string> | undefined;
    private changeNameEmitter: vscode.EventEmitter<string> | undefined;
    private exitEmitter = new vscode.EventEmitter<void>();
    private closeEmitter: vscode.EventEmitter<number> | undefined =
        new vscode.EventEmitter<number>();
    private _terminalName: string;
    private _source: string | undefined;
    private buffer: string = "";

    private fireData(data: string) {
        if (this.writeEmitter === undefined) {
            this.buffer += data;
            return;
        }
        this.writeEmitter?.fire(data);
    }

    private fireNameChange(name: string) {
        this.changeNameEmitter?.fire(name);
    }

    set terminalName(name: string) {
        this._terminalName = name;
        this.fireNameChange(`${this.source()}${name}`);
    }

    public get onExitEvent(): vscode.Event<void> {
        return this.exitEmitter.event;
    }

    constructor(terminalName: string, source: string) {
        this._terminalName = terminalName;
        this._source = source;
    }

    private source() {
        if (this._source === undefined || this._source.length === 0) {
            return "";
        }
        return this._source + ": ";
    }

    error() {
        this.fireNameChange("❌ " + this.source() + this._terminalName);
    }

    success() {
        this.fireNameChange("✅ " + this.source() + this._terminalName);
    }

    cancel() {
        this.fireNameChange("🚫 " + this.source() + this._terminalName);
    }

    dispose() {
        // Clean up event emitters, so a task can not flush data to disposed terminal
        this.writeEmitter = undefined;
        this.changeNameEmitter = undefined;
    }

    private dataToPrint(data: string): string {
        return data.replaceAll("\n", "\n\r");
    }

    private getStyledText(text: string, style: TerminalMessageStyle): string {
        if (style === TerminalMessageStyle.default) {
            return text;
        }

        const styleMap: Record<TerminalMessageStyle, string> = {
            [TerminalMessageStyle.default]: "",
            [TerminalMessageStyle.command]: "\x1b[100m",
            [TerminalMessageStyle.error]: "\x1b[41m",
            [TerminalMessageStyle.warning]: "\x1b[43m",
            [TerminalMessageStyle.success]: "\x1b[42m",
        };

        // Apply style to each line separately to prevent background bleeding
        const lines = text.split("\n");
        const styledLines = lines.map(line => {
            if (!line) {
                return line;
            }
            return `${styleMap[style]}${line}\x1b[0m`;
        });

        return styledLines.join("\n");
    }

    public write(data: string, style = TerminalMessageStyle.default): void {
        const toPrint = this.dataToPrint(data);
        const styledText = this.getStyledText(toPrint, style);
        this.fireData(styledText);
    }

    createSudoTerminalForTask(task: () => Promise<void>): Promise<vscode.Pseudoterminal> {
        return new Promise(resolve => {
            if (!this.writeEmitter) {
                this.writeEmitter = new vscode.EventEmitter<string>();
            }
            if (!this.changeNameEmitter) {
                this.changeNameEmitter = new vscode.EventEmitter<string>();
            }
            if (!this.closeEmitter) {
                this.closeEmitter = new vscode.EventEmitter<number>();
            }
            const terminalCloseEmitter = this.closeEmitter;
            const pty: vscode.Pseudoterminal = {
                onDidWrite: this.writeEmitter.event,
                onDidChangeName: this.changeNameEmitter.event,
                onDidClose: terminalCloseEmitter.event,
                open: async () => {
                    try {
                        this.terminalName = this._terminalName;
                        if (this.buffer.length > 0) {
                            this.fireData(this.buffer);
                            this.buffer = "";
                        }
                        await task();
                        terminalCloseEmitter.fire(0);
                    } catch (err) {
                        terminalCloseEmitter.fire(1);
                    }
                },
                close: () => {
                    this.exitEmitter.fire();
                },
            };
            resolve(pty);
        });
    }
}
