import * as vscode from "vscode";
import { Executor, ExecutorMode, ExecutorReturnType } from "../execShell";

export class CommandContext {
    cancellationToken: vscode.CancellationTokenSource;
    private executor: Executor;

    constructor(cancellationToken: vscode.CancellationTokenSource, executor: Executor) {
        this.cancellationToken = cancellationToken;
        this.executor = executor;
    }

    public async execShell(
        commandName: string | "shellScript",
        fileOrCommand: string,
        args: string[] = [],
        showTerminal = false,
        returnType = ExecutorReturnType.statusCode,
        mode: ExecutorMode = ExecutorMode.verbose
    ): Promise<boolean | string> {
        return await this.executor.execShell(
            this.cancellationToken.token,
            commandName,
            fileOrCommand,
            args,
            showTerminal,
            returnType,
            mode
        )
    }
}