import {
    spawn,
    ChildProcess,
    SpawnOptions,
} from "child_process";
import { getEnv, getScriptPath, getWorkspacePath } from "./env";
import * as vscode from "vscode";
import { killAll } from "./utils";
import { UserTerminatedError } from "./CommandManagement/CommandContext";
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
    signal: NodeJS.Signals | null;
    stderr: string;
    terminal: vscode.Terminal | null;
    public constructor(message: string, code: number | null, signal: NodeJS.Signals | null, stderr: string, terminal: vscode.Terminal | null) {
        super(message);
        this.code = code;
        this.signal = signal;
        this.stderr = stderr;
        this.terminal = terminal;
    }
}

export enum ExecutorMode {
    verbose,
    silently,
    onlyCommandNameAndResult
}

export interface ShellCommand {
    command: string
    labelInTerminal?: string
}

export interface ShellFileScript {
    file: string
    labelInTerminal?: string
}

export interface ShellExec {
    cancellationToken?: vscode.CancellationToken
    terminalName?: string
    scriptOrCommand: ShellCommand | ShellFileScript,
    args?: string[]
    mode?: ExecutorMode
    stdoutCallback?: (out: string) => void
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
            open: () => this.writeEmitter?.fire(`\x1b[42m${terminalId}:\x1b[0m\r\n`), //BgGreen
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
        try {
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

            let debugCommand: string;
            if (scriptOrCommand.labelInTerminal) {
                debugCommand = `COMMAND: ${scriptOrCommand.labelInTerminal}`;
            } else
                if (args.length > 0) {
                    debugCommand = `COMMAND: ${script} ${args.reduce((prev, curr) => {
                        return prev += " " + curr
                    })}\r\n`;
                } else {
                    debugCommand = `COMMAND: ${script}`;
                }

            if (mode === ExecutorMode.verbose || mode == ExecutorMode.onlyCommandNameAndResult) {
                this.writeEmitter?.fire(this.dataToPrint(`\x1b[100m${debugCommand}\x1b[0m\n`));
            }
            console.log(debugCommand);

            let stdout = "";
            proc.stdout?.on("data", (data) => {
                const str = data.toString();
                if (mode === ExecutorMode.verbose) {
                    this.writeEmitter?.fire(this.dataToPrint(str));
                }
                stdout += str;
                if (shell.stdoutCallback)
                    shell.stdoutCallback(str);
            });
            let stderr = "";
            proc.stderr?.on("data", (data) => {
                const str = data.toString();
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
                    this.changeNameEmitter?.fire(
                        `🚫 ${this.getTerminalName(displayCommandName)}`
                    );
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
                if (cancellationToken?.isCancellationRequested) {
                    this.terminateShellImp(proc);
                    return;
                }

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
                        if (mode === ExecutorMode.verbose) {
                            this.changeNameEmitter?.fire(
                                `❌ ${this.getTerminalName(displayCommandName)}`
                            );
                        }
                        if (mode !== ExecutorMode.silently && stderr.length > 0) {
                            this.writeEmitter?.fire(
                                this.dataToPrint(`\x1b[41m${stderr}\x1b[0m`) // BgRed
                            )
                        }
                        reject(new ExecutorTerminated(`${this.getTerminalName(displayCommandName)} is terminated with SIGNAL : ${error}`));
                        return;
                    }

                    if (mode !== ExecutorMode.verbose) {
                        this.writeEmitter?.fire(
                            this.dataToPrint(`\x1b[42m$ Exits with status code: ${code}\x1b[0m\n`) // BgGreen
                        );
                    }
                    if (code !== 0) {
                        if (mode === ExecutorMode.verbose) {
                            this.changeNameEmitter?.fire(
                                `❌ ${this.getTerminalName(displayCommandName)}`
                            );
                        }
                        if (mode !== ExecutorMode.silently) {
                            this.writeEmitter?.fire(
                                this.dataToPrint(`\x1b[41m${stderr}\x1b[0m`) // BgRed
                            );
                        }
                        reject(
                            new ExecutorTaskError(
                                `Task: ${this.getTerminalName(displayCommandName)} exits with ${code}`,
                                code,
                                signal,
                                stderr,
                                terminal
                            )
                        );
                    } else {
                        if (mode === ExecutorMode.verbose) {
                            this.changeNameEmitter?.fire(
                                `✅ ${this.getTerminalName(displayCommandName)}`
                            );
                        }
                        if (mode !== ExecutorMode.silently) {
                            this.writeEmitter?.fire(
                                this.dataToPrint(stderr)
                            )
                        }
                        resolve({ stdout: stdout, stderr: stderr });
                    }
                });
            });
        } catch (error) {
            if (this.childProc)
                this.terminateShellImp(this.childProc);
            throw error;
        }
    }
}
