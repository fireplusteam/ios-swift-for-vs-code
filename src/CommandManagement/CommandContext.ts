import * as vscode from "vscode";
import { Executor, ExecutorMode, ShellCommand, ShellFileScript, ShellResult } from "../Executor";
import { ProjectSettingsProvider } from "../Services/ProjectSettingsProvider";
import { TerminalShell } from "../TerminalShell";

export const UserTerminatedError: Error = new Error("User Terminated");
export const UserTerminalCloseError: Error = new Error("User Terminal Close");

interface CommandOptions {
    scriptOrCommand: ShellCommand | ShellFileScript,
    args?: string[]
    mode?: ExecutorMode
    pipeToDebugConsole?: boolean
}

export class CommandContext {
    private _projectSettingsProvider: ProjectSettingsProvider;
    get projectSettingsProvider(): ProjectSettingsProvider {
        return this._projectSettingsProvider;
    }
    private _debugConsoleEmitter = new vscode.EventEmitter<string>();
    get debugConsoleEvent(): vscode.Event<string> {
        return this._debugConsoleEmitter.event;
    }

    private _terminal?: TerminalShell;
    public get terminal(): TerminalShell | undefined {
        return this._terminal;
    }

    private _cancellationTokenSource: vscode.CancellationTokenSource;
    public get cancellationToken(): vscode.CancellationToken {
        return this._cancellationTokenSource.token;
    }

    constructor(cancellationToken: vscode.CancellationTokenSource, terminal: TerminalShell | undefined) {
        this._cancellationTokenSource = cancellationToken;
        this._projectSettingsProvider = new ProjectSettingsProvider(this);
        this._terminal = terminal;
    }

    public async execShellWithOptions(
        shell: CommandOptions
    ): Promise<ShellResult> {
        const stdoutCallback = shell.pipeToDebugConsole ? (out: string) => {
            this._debugConsoleEmitter.fire(out);
        } : undefined;

        return await new Executor().execShell(
            {
                cancellationToken: this._cancellationTokenSource.token,
                ...shell,
                terminal: this._terminal,
                stdoutCallback: stdoutCallback
            }
        );
    }

    public async execShell(
        terminalName: string,
        scriptOrCommand: ShellCommand | ShellFileScript,
        args: string[] = [],
        mode: ExecutorMode = ExecutorMode.verbose,
    ): Promise<ShellResult> {
        return await new Executor().execShell({
            cancellationToken: this._cancellationTokenSource.token,
            scriptOrCommand: scriptOrCommand,
            args: args,
            mode: mode,
            terminal: this._terminal
        });
    }

    public async execShellParallel(
        shell: CommandOptions
    ): Promise<ShellResult> {
        const stdoutCallback = shell.pipeToDebugConsole ? (out: string) => {
            this._debugConsoleEmitter.fire(out);
        } : undefined;

        return await new Executor().execShell({
            cancellationToken: this._cancellationTokenSource.token,
            ...shell,
            stdoutCallback: stdoutCallback
        });
    }

    public async waitToCancel() {
        let dis: vscode.Disposable;
        return new Promise<void>((resolve) => {
            if (this.cancellationToken.isCancellationRequested) {
                resolve();
                return;
            }
            dis = this.cancellationToken.onCancellationRequested(e => {
                dis.dispose();
                resolve();
            });
        });
    }

    public cancel() {
        this._cancellationTokenSource.cancel();
    }
}