import * as vscode from "vscode";

export enum TerminalMessageStyle {
    default,
    success,
    command,
    error,
    warning,
}

export class TerminalShell {
    private terminal?: Promise<vscode.Terminal>;
    private writeEmitter: vscode.EventEmitter<string> | undefined;
    private changeNameEmitter: vscode.EventEmitter<string> | undefined;
    private animationInterval: NodeJS.Timeout | undefined;
    private exitEmitter = new vscode.EventEmitter<void>();
    private _terminalName: string;

    private bindWriteEmitters: vscode.EventEmitter<string>[] = [];
    private bindChangeNameEmitters: vscode.EventEmitter<string>[] = [];

    private canCreateTerminal: boolean;

    public bindToOutputEmitter(emitter: vscode.EventEmitter<string>) {
        this.bindWriteEmitters.push(emitter);
    }

    public bindToNameChangeEmitter(emitter: vscode.EventEmitter<string>) {
        this.bindChangeNameEmitters.push(emitter);
    }

    private fireData(data: string) {
        this.writeEmitter?.fire(data);
        this.bindWriteEmitters.forEach(emitter => {
            emitter.fire(data);
        });
    }

    private fireNameChange(name: string) {
        this.changeNameEmitter?.fire(name);
        this.bindChangeNameEmitters.forEach(emitter => {
            emitter.fire(name);
        });
    }

    set terminalName(name: string) {
        this._terminalName = name;
        if (this.canCreateTerminal) {
            this.terminal = this.getTerminal(name);
        }
        this.fireNameChange(`${name}`);
    }

    public get onExitEvent(): vscode.Event<void> {
        return this.exitEmitter.event;
    }

    constructor(terminalName: string, canCreateTerminal: boolean = true) {
        this._terminalName = terminalName;
        this.canCreateTerminal = canCreateTerminal;
    }

    error() {
        this.terminalName = "❌ " + this._terminalName;
        this.stop();
    }

    success() {
        this.terminalName = "✅ " + this._terminalName;
        this.stop();
    }

    cancel() {
        this.terminalName = "🚫 " + this._terminalName;
        this.stop();
    }

    private stop() {
        clearInterval(this.animationInterval);
        this.animationInterval = undefined;
    }

    public show() {
        this.terminal?.then(terminal => terminal.show());
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
        const writeData = () => {
            const toPrint = this.dataToPrint(data);
            const styledText = this.getStyledText(toPrint, style);
            this.fireData(styledText);
        };
        if (this.canCreateTerminal === false) {
            writeData();
            return;
        }

        this.terminal?.then(() => {
            writeData();
        });
    }

    private createTitleAnimation(terminalId: string) {
        // animation steps
        const steps = ["\\", "|", "/", "-"];
        let currentIndex = 0;
        // start the animation
        const animationInterval = setInterval(() => {
            currentIndex = (currentIndex + 1) % steps.length;
            this.fireNameChange(`${steps[currentIndex]} ${terminalId}`);
        }, 1000); // Change this to control animation speed
        return animationInterval;
    }

    private getTerminalName(id: string) {
        const terminalId = `Xcode: ${id}`;
        return terminalId;
    }

    private getTerminal(id: string): Promise<vscode.Terminal> {
        const terminalId = this.getTerminalName(id);
        clearInterval(this.animationInterval);
        this.animationInterval = this.createTitleAnimation(terminalId);
        if (this.terminal) {
            return this.terminal;
        }

        return new Promise((resolve, reject) => {
            this.writeEmitter = new vscode.EventEmitter<string>();
            this.changeNameEmitter = new vscode.EventEmitter<string>();
            let terminal: vscode.Terminal | undefined = undefined;
            const pty: vscode.Pseudoterminal = {
                onDidWrite: this.writeEmitter.event,
                onDidChangeName: this.changeNameEmitter.event,
                open: () => {
                    this.fireData(`\x1b[42m${terminalId}:\x1b[0m\r\n`);
                    if (terminal) {
                        resolve(terminal);
                    } else {
                        reject(Error("Terminal is not created"));
                    }
                }, //BgGreen
                close: () => {
                    this.terminal = undefined;
                    this.exitEmitter.fire();
                },
            };
            terminal = vscode.window.createTerminal({
                name: terminalId,
                pty: pty,
            });
        });
    }
}
