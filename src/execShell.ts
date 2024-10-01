import {
    spawn,
    ChildProcess,
    SpawnOptions,
} from "child_process";
import { getEnv, getScriptPath, getWorkspacePath } from "./env";
import * as vscode from "vscode";
import { killAll } from "./utils";
import { CommandContext, UserTerminatedError } from "./CommandManagement/CommandContext";
import { error } from "console";

export class ExecutorTerminated extends Error {
    public constructor(message: string) {
        super(message);
    }
}

export class ExecutorRunningError extends Error {
    commandName: string | undefined;
    public constructor(message: string, commandName: string | undefined) {
        super(message);
        this.commandName = commandName;
    }
}

export class ExecutorTaskError extends Error {
    code: number | null;
    stderr: string;
    terminal: vscode.Terminal | null;
    public constructor(message: string, code: number | null, stderr: string, terminal: vscode.Terminal | null) {
        super(message);
        this.code = code;
        this.stderr = stderr;
        this.terminal = terminal;
    }
}

export enum ExecutorMode {
    verbose,
    silently
}

export interface ShellCommand {
    command: string
}

export interface ShellExec {
    cancellationToken?: vscode.CancellationToken
    terminalName?: string
    scriptOrCommand: ShellCommand | ShellFileScript,
    args?: string[]
    mode?: ExecutorMode
}

export interface ShellFileScript {
    file: string
}

export interface ShellResult {
    stdout: string
    stderr: string
}

export class Executor {
    private _executingCommand: string | undefined;
    private terminal: vscode.Terminal | undefined;
    private writeEmitter: vscode.EventEmitter<string> | undefined;
    private changeNameEmitter: vscode.EventEmitter<string> | undefined;
    private childProc: ChildProcess | undefined;
    private animationInterval: NodeJS.Timeout | undefined;

    private onExit = new vscode.EventEmitter<void>();

    public get executingCommand(): string | undefined {
        return this._executingCommand;
    }

    get isRunning(): boolean {
        return this.childProc != undefined;
    }

    public constructor() { }

    createTitleAnimation(terminalId: string) {
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
        const terminalId = `iOS: ${id}`;
        return terminalId;
    }

    private getTerminal(id: string) {
        const terminalId = this.getTerminalName(id);
        clearInterval(this.animationInterval);
        this.animationInterval = this.createTitleAnimation(terminalId);
        if (this.terminal) {
            if (this.terminal.name === terminalId) {
                return this.terminal;
            }
            this.changeNameEmitter?.fire(`${terminalId}`);
            return this.terminal;
        }
        this.writeEmitter = new vscode.EventEmitter<string>();
        this.changeNameEmitter = new vscode.EventEmitter<string>();
        const pty: vscode.Pseudoterminal = {
            onDidWrite: this.writeEmitter.event,
            onDidChangeName: this.changeNameEmitter.event,
            open: () => this.writeEmitter?.fire(`\x1b[31${terminalId}\x1b[0m`),
            close: () => {
                this.terminal = undefined;
                this.onExit.fire();
            },
        };
        this.terminal = vscode.window.createTerminal({
            name: terminalId,
            pty: pty,
        });
        return this.terminal;
    }

    private terminateShellImp(proc: ChildProcess) {
        if (this.childProc !== proc) {
            console.warn("Try to terminate wrong process");
        }
        clearInterval(this.animationInterval);
        this.animationInterval = undefined;
        this.childProc = undefined;
        this._executingCommand = undefined;
        this.onExit.fire();
    }

    private execShellImp(
        file: string,
        args: ReadonlyArray<string>,
        options: SpawnOptions
    ) {
        const quotedArgs = args.map((e) => {
            return `"${e}"`;
        });
        return spawn(file, quotedArgs, options);
    }

    private dataToPrint(data: string) {
        data = data.replaceAll("\n", "\n\r");
        return data;
    }

    public async execShell(
        shell: ShellExec
    ): Promise<ShellResult> {
        const cancellationToken = shell.cancellationToken;
        const terminalName = shell.terminalName ?? "";
        const scriptOrCommand = shell.scriptOrCommand;
        const args = shell.args || [];
        const mode = shell.mode || (shell.terminalName ? ExecutorMode.verbose : ExecutorMode.silently);

        if (cancellationToken && cancellationToken.isCancellationRequested) {
            throw Promise.reject(UserTerminatedError);
        }
        if (this.isRunning) {
            throw Promise.reject(new ExecutorRunningError("Another task is running", this._executingCommand));
        }
        const env = await getEnv();
        const envOptions = {
            ...process.env,
            ...env,
        };
        let script: string = "";
        let displayCommandName = terminalName;

        if ("file" in scriptOrCommand) {
            script = getScriptPath(scriptOrCommand.file);
            if (script.indexOf(".py") !== -1) {
                script = `python3 "${script}"`;
            }
        } else {
            script = scriptOrCommand.command;
        }

        const proc = this.execShellImp(script, args, {
            cwd: getWorkspacePath(),
            shell: true,
            env: envOptions,
            stdio: "pipe",
        });
        this._executingCommand = displayCommandName;
        this.childProc = proc;
        const terminal = mode === ExecutorMode.silently ? null : this.getTerminal(displayCommandName);
        const debugCommand = `COMMAND: ${script} ${args.reduce((prev, curr) => {
            return prev += " " + curr
        })}\r\n`;
        if (mode === ExecutorMode.verbose) {
            this.writeEmitter?.fire(debugCommand);
        }
        console.log(debugCommand);

        let stdout = "";
        proc.stdout?.on("data", (data) => {
            const str = data.toString();
            if (mode === ExecutorMode.verbose) {
                this.writeEmitter?.fire(this.dataToPrint(str));
            }
            stdout += str;
        });
        let stderr = "";
        proc.stderr?.on("data", (data) => {
            const str = data.toString();
            if (mode === ExecutorMode.verbose) {
                this.writeEmitter?.fire(this.dataToPrint(str));
            }
            stderr += str;
        });

        return new Promise((resolve, reject) => {
            let userCancel: vscode.Disposable | undefined;
            let terminalClose: vscode.Disposable | undefined;
            userCancel = cancellationToken?.onCancellationRequested(() => {
                userCancel?.dispose();
                terminalClose?.dispose();
                reject(UserTerminatedError);
                if (proc.killed || proc.exitCode != null || proc.signalCode != null || this.childProc != proc)
                    return;

                this.terminateShellImp(proc);
                if (mode !== ExecutorMode.silently) {
                    this.changeNameEmitter?.fire(
                        `🚫 ${this.getTerminalName(displayCommandName)}`
                    );
                }
                killAll(proc.pid, "SIGKILL");
            });
            terminalClose = this.onExit.event(() => {
                userCancel?.dispose();
                terminalClose?.dispose();
                reject(UserTerminatedError);
                if (proc.killed || proc.exitCode != null || proc.signalCode != null || this.childProc != proc)
                    return;

                this.terminateShellImp(proc);
                killAll(proc.pid, "SIGKILL");
            });

            proc.once("error", (err) => {
                userCancel?.dispose();
                terminalClose?.dispose();
                if (this.childProc !== proc) {
                    console.log("Error, wrong child process error")
                    return;
                }
                this.terminateShellImp(proc);
                reject(err);
            });

            proc.once("exit", (code, signal) => {
                userCancel?.dispose();
                terminalClose?.dispose();

                if (this.childProc !== proc) {
                    console.log("Error, wrong child process terminated")
                    return;
                }
                this.terminateShellImp(proc)

                if (signal !== null) {
                    if (mode !== ExecutorMode.silently) {
                        this.changeNameEmitter?.fire(
                            `❌ ${this.getTerminalName(displayCommandName)}`
                        );
                    }
                    reject(new ExecutorTerminated(`${this.getTerminalName(displayCommandName)} is terminated with SIGNAL : ${error}`));
                    return;
                }

                if (mode === ExecutorMode.verbose) {
                    this.writeEmitter?.fire(
                        this.dataToPrint(`${this.getTerminalName(displayCommandName)} exits with status code: ${code}\n`)
                    );
                }
                if (code !== 0) {
                    if (mode !== ExecutorMode.silently) {
                        this.changeNameEmitter?.fire(
                            `❌ ${this.getTerminalName(displayCommandName)}`
                        );
                    }
                    reject(
                        new ExecutorTaskError(
                            `Task: ${this.getTerminalName(displayCommandName)} exits with ${code}`,
                            code,
                            stderr,
                            terminal
                        )
                    );
                } else {
                    if (mode !== ExecutorMode.silently) {
                        this.changeNameEmitter?.fire(
                            `✅ ${this.getTerminalName(displayCommandName)}`
                        );
                    }
                    resolve({ stdout: stdout, stderr: stderr });
                }
            });
        });
    }
}
