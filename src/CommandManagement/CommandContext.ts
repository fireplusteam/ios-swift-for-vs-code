import * as vscode from "vscode";
import { Executor, ExecutorMode, ExecutorReturnType, ShellCommandName } from "../execShell";

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
        commandName: string | ShellCommandName,
        fileOrCommand: string,
        args: string[] = [],
        showTerminal = false,
        returnType = ExecutorReturnType.statusCode,
        mode: ExecutorMode = ExecutorMode.verbose
    ): Promise<boolean | string> {
        return await this._executor.execShell(
            this._cancellationTokenSource.token,
            commandName,
            fileOrCommand,
            args,
            showTerminal,
            returnType,
            mode
        )
    }

    public cancel() {
        this._cancellationTokenSource.cancel();
    }
}