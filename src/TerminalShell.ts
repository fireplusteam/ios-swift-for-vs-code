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

    set terminalName(name: string) {
        this._terminalName = name;
        this.terminal = this.getTerminal(name);
    }

    public get onExitEvent(): vscode.Event<void> {
        return this.exitEmitter.event;
    }

    constructor(terminalName: string) {
        this._terminalName = terminalName;
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

    private dataToPrint(data: string) {
        data = data.replaceAll("\n", "\n\r");
        return data;
    }

    public write(data: string, style = TerminalMessageStyle.default) {
        this.terminal?.then(() => {
            const toPrint = this.dataToPrint(data);
            switch (style) {
                case TerminalMessageStyle.default:
                    this.writeEmitter?.fire(toPrint);
                    break;
                case TerminalMessageStyle.command:
                    this.writeEmitter?.fire(`\x1b[100m${toPrint}\x1b[0m`);
                    break;
                case TerminalMessageStyle.error:
                    this.writeEmitter?.fire(`\x1b[41m${toPrint}\x1b[0m`); // BgRed
                    break;
                case TerminalMessageStyle.warning:
                    this.writeEmitter?.fire(`\x1b[43m${toPrint}\x1b[0m`); // BgYellow
                    break;
                case TerminalMessageStyle.success:
                    this.writeEmitter?.fire(`\x1b[42m${toPrint}\x1b[0m`); // BgGreen
                    break;
            }
        });
    }

    private createTitleAnimation(terminalId: string) {
        // animation steps
        const steps = ["\\", "|", "/", "-"];
        let currentIndex = 0;
        // start the animation
        const animationInterval = setInterval(() => {
            currentIndex = (currentIndex + 1) % steps.length;
            this.changeNameEmitter?.fire(`${steps[currentIndex]} ${terminalId}`);
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
            this.changeNameEmitter?.fire(`${terminalId}`);
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
                    this.writeEmitter?.fire(`\x1b[42m${terminalId}:\x1b[0m\r\n`);
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
