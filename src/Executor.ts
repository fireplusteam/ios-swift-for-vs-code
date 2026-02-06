import { ChildProcess, spawn, SpawnOptions } from "child_process";
import { getScriptPath, getWorkspacePath } from "./env";
import * as vscode from "vscode";
import { killAll, sleep } from "./utils";
import { UserTerminalCloseError, UserTerminatedError } from "./CommandManagement/CommandContext";
import { TerminalMessageStyle, TerminalShell } from "./TerminalShell";
import { PassThrough } from "stream";
import { kill } from "process";

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
    onlyCommandNameAndResult = commandName | resultOk | resultError | stderr,
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
    stderrCallback?: (err: string) => void;
    terminal?: TerminalShell;
    pipe?: ShellExec;
    kill?: { signal: NodeJS.Signals; allSubProcesses: boolean };
}

export interface ShellResult {
    stdout: string;
    stderr: string;
}

export interface ShellProcessResult {
    proc: ChildProcess;
    result: Promise<ShellResult>;
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

    public execShellAndProc(shell: ShellExec): ShellProcessResult {
        return this.execShellByGettingProc(shell);
    }

    private execShellByGettingProc(shell: ShellExec): ShellProcessResult {
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

        const pipeStdoutBuffer = new PassThrough({ highWaterMark: 1024 });
        const pipeStdErrBuffer = new PassThrough({ highWaterMark: 1024 });
        proc.stdout?.pipe(pipeStdoutBuffer);
        proc.stderr?.pipe(pipeStdErrBuffer);

        let pipeProc:
            | {
                  proc: ChildProcess;
                  result: Promise<ShellResult>;
              }
            | undefined;
        if (shell.pipe) {
            pipeProc = this.execShellByGettingProc(shell.pipe);
            if (pipeProc.proc.stdin) {
                pipeStdoutBuffer.pipe(pipeProc.proc.stdin);
                pipeStdErrBuffer.pipe(pipeProc.proc.stdin);
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
        const textDecoder = new TextDecoder();
        pipeStdoutBuffer.on("data", data => {
            const str = textDecoder.decode(data);
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
        pipeStdErrBuffer.on("data", data => {
            const str = textDecoder.decode(data);
            if (mode & ExecutorMode.stderr) {
                if (terminal) {
                    terminal?.write(str, TerminalMessageStyle.warning);
                }
            }
            stderr += str;
            if (shell.stderrCallback) {
                shell.stderrCallback(str);
            }
        });

        let isKilled = false;
        const killAction = () => {
            if (proc.pid !== undefined && !isKilled) {
                isKilled = true;
                if (shell.kill) {
                    if (shell.kill.allSubProcesses) {
                        killAll(proc.pid, shell.kill.signal);
                    } else {
                        kill(proc.pid, shell.kill.signal);
                    }
                } else {
                    // by default send SIGINT to all subprocesses to allow graceful termination
                    killAll(proc.pid, "SIGINT");
                }
                sleep(25000).then(() => {
                    // check if process is still alive after waiting for graceful termination
                    if (proc.exitCode === null) {
                        // if it's still running - force kill
                        killAll(proc.pid, "SIGKILL");
                    }
                });
            }
        };

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

                    killAction();
                });
                const terminalClose = terminal?.onExitEvent(() => {
                    userCancel?.dispose();
                    terminalClose?.dispose();
                    reject(UserTerminalCloseError);
                    if (proc.killed || proc.exitCode !== null || proc.signalCode !== null) {
                        return;
                    }

                    killAction();
                });
                if (cancellationToken?.isCancellationRequested) {
                    reject(UserTerminatedError);
                    return;
                }

                proc.once("error", err => {
                    userCancel?.dispose();
                    terminalClose?.dispose();
                    pipeProc?.proc.stdin?.end();
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
                        reject(
                            new ExecutorTerminated(
                                `${displayCommandName} is terminated with SIGNAL : ${signal}`
                            )
                        );
                        return;
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
