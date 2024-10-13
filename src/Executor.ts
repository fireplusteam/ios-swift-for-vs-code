import { spawn, SpawnOptions } from "child_process";
import { getEnv, getScriptPath, getWorkspacePath } from "./env";
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
    verbose,
    silently,
    onlyCommandNameAndResult,
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
    mode?: ExecutorMode;
    stdoutCallback?: (out: string) => void;
    terminal?: TerminalShell;
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
        const cancellationToken = shell.cancellationToken;
        const scriptOrCommand = shell.scriptOrCommand;
        const args = shell.args || [];
        const mode = shell.mode === undefined ? ExecutorMode.silently : shell.mode;

        if (cancellationToken && cancellationToken.isCancellationRequested) {
            throw Promise.reject(UserTerminatedError);
        }
        const env = await getEnv();
        const envOptions = {
            ...process.env,
            ...env,
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

        if (mode === ExecutorMode.verbose || mode === ExecutorMode.onlyCommandNameAndResult) {
            terminal?.write(debugCommand, TerminalMessageStyle.command);
        }
        console.log(debugCommand);

        let stdout = "";
        proc.stdout?.on("data", data => {
            const str = data.toString();
            if (mode === ExecutorMode.verbose) {
                terminal?.write(str);
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

        return new Promise((resolve, reject) => {
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

            proc.once("exit", (code, signal) => {
                userCancel?.dispose();
                terminalClose?.dispose();

                if (signal !== null) {
                    if (mode !== ExecutorMode.silently && stderr.length > 0) {
                        terminal?.write(stderr, TerminalMessageStyle.warning);
                    }
                    reject(
                        new ExecutorTerminated(
                            `${displayCommandName} is terminated with SIGNAL : ${error}`
                        )
                    );
                    return;
                }

                if (mode !== ExecutorMode.silently) {
                    terminal?.write(
                        `Exits with status code: ${code}\x1b\n`,
                        code !== 0 ? TerminalMessageStyle.error : TerminalMessageStyle.success
                    );
                }
                if (code !== 0) {
                    if (mode !== ExecutorMode.silently) {
                        terminal?.write(stderr, TerminalMessageStyle.warning);
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
                    if (mode !== ExecutorMode.silently) {
                        terminal?.write(stderr, TerminalMessageStyle.warning);
                    }
                    resolve({ stdout: stdout, stderr: stderr });
                }
            });
        });
    }
}
