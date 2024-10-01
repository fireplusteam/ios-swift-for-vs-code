import * as vscode from "vscode";
import { Executor, ExecutorMode, ShellCommand, ShellFileScript, ShellResult } from "../execShell";

export const UserTerminatedError: Error = new Error("Terminated");

export class CommandContext {

    private _cancellationTokenSource: vscode.CancellationTokenSource;
    private _executor: Executor;
    public get executor(): Executor {
        return this.executor;
    }
    public get cancellationToken(): vscode.CancellationToken {
        return this._cancellationTokenSource.token;
    }

    constructor(cancellationToken: vscode.CancellationTokenSource, executor: Executor) {
        this._cancellationTokenSource = cancellationToken;
        this._executor = executor;
    }

    public async execShell(
        terminalName: string,
        scriptOrCommand: ShellCommand | ShellFileScript,
        args: string[] = [],
        mode: ExecutorMode = ExecutorMode.verbose,
    ): Promise<ShellResult> {
        return await this._executor.execShell({
            cancellationToken: this._cancellationTokenSource.token,
            terminalName: terminalName,
            scriptOrCommand: scriptOrCommand,
            args: args,
            mode: mode
        })
    }

    public cancel() {
        this._cancellationTokenSource.cancel();
    }
}