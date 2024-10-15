import { ChildProcess, spawn, SpawnOptions } from "child_process";
import { getScriptPath, getWorkspacePath } from "./env";
import * as vscode from "vscode";
import { killAll } from "./utils";
import { UserTerminalCloseError, UserTerminatedError } from "./CommandManagement/CommandContext";
import { error } from "console";
import { TerminalMessageStyle, TerminalShell } from "./TerminalShell";

export class ExecutorTerminated extends Error {
    public constructor(message: string) {
        super(message);
    }
}

export class ExecutorTaskError extends Error {
    code: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
    terminal?: TerminalShell;
    public constructor(
        message: string,
        code: number | null,
        signal: NodeJS.Signals | null,
        stderr: string,
        terminal: TerminalShell | undefined
    ) {
        super(message);
        this.code = code;
        this.signal = signal;
        this.stderr = stderr;
        this.terminal = terminal;
    }
}

export enum ExecutorMode {
    none = 0,
    commandName = 1 << 1,
    resultOk = 1 << 2,
    resultError = 1 << 3,
    stdout = 1 << 4,
    stderr = 1 << 5,
    // frequently used subsets
    onlyCommandNameAndResult = commandName | resultOk | resultError,
    verbose = commandName | resultOk | resultError | stdout | stderr,
}

export interface ShellCommand {
    command: string;
    labelInTerminal?: string;
}

export interface ShellFileScript {
    file: string;
    labelInTerminal?: string;
}

export interface ShellExec {
    cancellationToken?: vscode.CancellationToken;
    scriptOrCommand: ShellCommand | ShellFileScript;
    cwd?: string;
    args?: string[];
    env?: { [name: string]: string };
    mode?: ExecutorMode;
    stdoutCallback?: (out: string) => void;
    terminal?: TerminalShell;
    pipe?: ShellExec;
}

export interface ShellResult {
    stdout: string;
    stderr: string;
}

export class Executor {
    public constructor() {}

    private execShellImp(file: string, args: ReadonlyArray<string>, options: SpawnOptions) {
        const quotedArgs = args.map(e => {
            return `"${e}"`;
        });
        return spawn(file, quotedArgs, options);
    }
    public async execShell(shell: ShellExec): Promise<ShellResult> {
        return this.execShellByGettingProc(shell).result;
    }

    private execShellByGettingProc(shell: ShellExec): {
        proc: ChildProcess;
        result: Promise<ShellResult>;
    } {
        const cancellationToken = shell.cancellationToken;
        const scriptOrCommand = shell.scriptOrCommand;
        const args = shell.args || [];
        const mode = shell.mode === undefined ? ExecutorMode.none : shell.mode;

        if (cancellationToken && cancellationToken.isCancellationRequested) {
            throw Promise.reject(UserTerminatedError);
        }
        const envOptions = {
            ...process.env,
            ...shell.env,
        };
        let script: string = "";
        let displayCommandName: string = "";

        if ("file" in scriptOrCommand) {
            displayCommandName = scriptOrCommand.file;
            script = getScriptPath(scriptOrCommand.file);
            if (script.indexOf(".py") !== -1) {
                script = `python3 "${script}"`;
            }
        } else {
            displayCommandName = scriptOrCommand.command;
            script = scriptOrCommand.command;
        }

        const proc = this.execShellImp(script, args, {
            cwd: shell.cwd || getWorkspacePath(),
            shell: true,
            env: envOptions,
            stdio: "pipe",
        });

        let pipeProc:
            | {
                  proc: ChildProcess;
                  result: Promise<ShellResult>;
              }
            | undefined;
        if (shell.pipe) {
            pipeProc = this.execShellByGettingProc(shell.pipe);
            if (pipeProc.proc.stdin) {
                proc.stdout?.pipe(pipeProc.proc.stdin);
                proc.stderr?.pipe(pipeProc.proc.stdin);
            }
        }

        const terminal = shell.terminal;

        let debugCommand: string;
        if (scriptOrCommand.labelInTerminal) {
            debugCommand = `COMMAND: ${scriptOrCommand.labelInTerminal}\n`;
        } else if (args.length > 0) {
            debugCommand = `COMMAND: ${script} ${args.reduce((prev, curr) => {
                return (prev += " " + curr);
            })}\n`;
        } else {
            debugCommand = `COMMAND: ${script}\n`;
        }

        if (mode & ExecutorMode.commandName) {
            terminal?.write(debugCommand, TerminalMessageStyle.command);
        }
        console.log(debugCommand);

        let stdout = "";
        proc.stdout?.on("data", data => {
            const str = data.toString();
            if (mode & ExecutorMode.stdout) {
                if (terminal) {
                    terminal?.write(str);
                }
            }
            stdout += str;
            if (shell.stdoutCallback) {
                shell.stdoutCallback(str);
            }
        });
        let stderr = "";
        proc.stderr?.on("data", data => {
            const str = data.toString();
            stderr += str;
        });

        return {
            proc: proc,
            result: new Promise((resolve, reject) => {
                const userCancel = cancellationToken?.onCancellationRequested(() => {
                    userCancel?.dispose();
                    terminalClose?.dispose();
                    reject(UserTerminatedError);
                    if (proc.killed || proc.exitCode !== null || proc.signalCode !== null) {
                        return;
                    }

                    killAll(proc.pid, "SIGKILL");
                });
                const terminalClose = terminal?.onExitEvent(() => {
                    userCancel?.dispose();
                    terminalClose?.dispose();
                    reject(UserTerminalCloseError);
                    if (proc.killed || proc.exitCode !== null || proc.signalCode !== null) {
                        return;
                    }

                    killAll(proc.pid, "SIGKILL");
                });
                if (cancellationToken?.isCancellationRequested) {
                    reject(UserTerminatedError);
                    return;
                }

                proc.once("error", err => {
                    userCancel?.dispose();
                    terminalClose?.dispose();
                    reject(err);
                });

                proc.once("exit", async (code, signal) => {
                    userCancel?.dispose();
                    terminalClose?.dispose();
                    pipeProc?.proc.stdin?.end();
                    try {
                        await pipeProc?.result;
                    } catch {
                        /* empty */
                    }

                    if (signal !== null) {
                        if (mode & ExecutorMode.stderr && stderr.length > 0) {
                            terminal?.write(stderr, TerminalMessageStyle.warning);
                        }
                        reject(
                            new ExecutorTerminated(
                                `${displayCommandName} is terminated with SIGNAL : ${error}`
                            )
                        );
                        return;
                    }

                    if (mode & ExecutorMode.stderr && stderr.length > 0) {
                        terminal?.write(stderr, TerminalMessageStyle.warning);
                    }

                    if (code !== 0) {
                        if (mode & ExecutorMode.resultError) {
                            terminal?.write(
                                `Exits with status code: ${code}\x1b\n`,
                                TerminalMessageStyle.error
                            );
                        }
                        reject(
                            new ExecutorTaskError(
                                `Task: ${displayCommandName} exits with ${code}`,
                                code,
                                signal,
                                stderr,
                                terminal
                            )
                        );
                    } else {
                        if (mode & ExecutorMode.resultOk) {
                            terminal?.write(
                                `Exits with status code: ${code}\x1b\n`,
                                TerminalMessageStyle.success
                            );
                        }
                        resolve({ stdout: stdout, stderr: stderr });
                    }
                });
            }),
        };
    }
}
