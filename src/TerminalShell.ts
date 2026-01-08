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
    private _terminalName: string;
    private _source: string | undefined;

    private fireData(data: string) {
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

    public show() {}

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

    createSudoTerminal(command: () => Promise<void>): Promise<vscode.Pseudoterminal> {
        return new Promise(resolve => {
            this.writeEmitter = new vscode.EventEmitter<string>();
            this.changeNameEmitter = new vscode.EventEmitter<string>();
            const closeEmitter = new vscode.EventEmitter<number>();
            const pty: vscode.Pseudoterminal = {
                onDidWrite: this.writeEmitter.event,
                onDidChangeName: this.changeNameEmitter.event,
                onDidClose: closeEmitter.event,
                open: async () => {
                    try {
                        await command();
                        closeEmitter.fire(0);
                    } catch (err) {
                        closeEmitter.fire(1);
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
