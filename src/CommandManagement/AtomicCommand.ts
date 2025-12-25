import * as vscode from "vscode";
import { ExecutorTaskError, ExecutorTerminated } from "../Executor";
import { Mutex, MutexInterface, E_CANCELED } from "async-mutex";
import { CommandContext, UserTerminalCloseError, UserTerminatedError } from "./CommandContext";
import { TerminalMessageStyle, TerminalShell } from "../TerminalShell";
import { LSPClientContext } from "../LSP/lspExtension";
import { CustomError } from "../utils";
import { getWorkspaceFolder } from "../env";
import { BundlePath } from "./BundlePath";

export const UserCommandIsExecuting = new CustomError("User task is currently executing");

function isShowErrorEnabled() {
    const isEnabled = vscode.workspace
        .getConfiguration("vscode-ios", getWorkspaceFolder())
        .get("show.log");
    if (!isEnabled) {
        return false;
    }
    return true;
}

function shouldAskTerminateCurrentTask() {
    const isEnabled = vscode.workspace
        .getConfiguration("vscode-ios", getWorkspaceFolder())
        .get("confirm.terminate.task");
    if (!isEnabled) {
        return false;
    }
    return true;
}

export class AtomicCommand {
    private _mutex = new Mutex();
    private _executingCommand: "user" | "autowatcher" | undefined = undefined;
    private latestOperationID: { id: number; type: "user" | "autowatcher" | undefined } = {
        id: 0,
        type: undefined,
    };
    private _prevCommandContext?: CommandContext;

    private userTerminal = new TerminalShell("User");
    private watcherTerminal = new TerminalShell("Watch");

    constructor(
        private readonly lspClient: LSPClientContext,
        private readonly log: vscode.OutputChannel
    ) {}

    async userCommandWithoutThrowingException(
        commandClosure: (commandContext: CommandContext) => Promise<void>,
        taskName: string | undefined
    ) {
        try {
            await this.userCommand(commandClosure, taskName);
        } catch (err) {
            // command wrapper shows an error, no more need to propagate it further
        }
    }

    async autoWatchCommand(commandClosure: (commandContext: CommandContext) => Promise<void>) {
        if (this.latestOperationID.type === "user") {
            throw UserCommandIsExecuting;
        }
        this.latestOperationID = { id: this.latestOperationID.id + 1, type: "autowatcher" };
        const currentOperationID = this.latestOperationID;
        let release: MutexInterface.Releaser | undefined = undefined;
        try {
            if (this._mutex.isLocked()) {
                if (this._executingCommand === "autowatcher") {
                    this._prevCommandContext?.cancel();
                    this._mutex.cancel();
                } else {
                    throw UserCommandIsExecuting;
                }
            }
            release = await this._mutex.acquire();
            if (currentOperationID !== this.latestOperationID) {
                throw E_CANCELED;
            }
            this._executingCommand = "autowatcher";
            const commandContext = new CommandContext(
                new vscode.CancellationTokenSource(),
                this.watcherTerminal,
                this.lspClient,
                new BundlePath("autowatcher"),
                this.log
            );
            this._prevCommandContext = commandContext;
            this.watcherTerminal.terminalName = "Watcher";
            await this.withCancellation(async () => {
                await commandClosure(commandContext);
            }, commandContext.cancellationToken);
            this.watcherTerminal.success();
        } catch (error) {
            if (error !== UserCommandIsExecuting) {
                if (UserTerminatedError.isEqual(error)) {
                    this.watcherTerminal.cancel();
                } else if (UserTerminalCloseError.isEqual(error) === false) {
                    this.watcherTerminal.error();
                }
                this.watcherTerminal.write(`${error}\n`, TerminalMessageStyle.error);
            }
            throw error;
        } finally {
            this.latestOperationID.type = undefined;
            this._executingCommand = undefined;
            if (release) {
                release();
            }
        }
    }

    private async withCancellation<T>(
        closure: () => Promise<T>,
        cancellation: vscode.CancellationToken
    ) {
        let dis: vscode.Disposable;
        return new Promise<T>(async (resolve, reject) => {
            try {
                dis = cancellation.onCancellationRequested(() => {
                    dis.dispose();
                    reject(UserTerminatedError);
                });
                resolve(await closure());
            } catch (err) {
                reject(err);
            }
        });
    }

    async userCommand<T>(
        commandClosure: (commandContext: CommandContext) => Promise<T>,
        taskName: string | undefined
    ) {
        this.latestOperationID = { id: this.latestOperationID.id + 1, type: "user" };
        const currentOperationID = this.latestOperationID;
        let releaser: MutexInterface.Releaser | undefined = undefined;
        let result: T;
        try {
            if (this._mutex.isLocked()) {
                let choice: string | undefined;
                if (this._executingCommand === "autowatcher" || !shouldAskTerminateCurrentTask()) {
                    choice = "Terminate";
                } else {
                    choice = await vscode.window.showErrorMessage(
                        "To execute this task you need to terminate the current task. Do you want to terminate it to continue?",
                        "Terminate",
                        "Cancel"
                    );
                }
                if (choice === "Terminate") {
                    this._prevCommandContext?.cancel();
                    this._mutex.cancel();
                } else {
                    throw UserCommandIsExecuting;
                }
            }
            releaser = await this._mutex.acquire();
            if (currentOperationID !== this.latestOperationID) {
                throw E_CANCELED;
            }
            this._executingCommand = "user";
            const commandContext = new CommandContext(
                new vscode.CancellationTokenSource(),
                this.userTerminal,
                this.lspClient,
                new BundlePath("bundle"),
                this.log
            );
            this._prevCommandContext = commandContext;
            if (taskName) {
                this.userTerminal.terminalName = `User: ${taskName}`;
            }
            result = await this.withCancellation(async () => {
                return await commandClosure(commandContext);
            }, commandContext.cancellationToken);
            if (taskName) {
                this.userTerminal.success();
            }

            return result;
        } catch (err) {
            if (err !== UserCommandIsExecuting && taskName) {
                if (UserTerminatedError.isEqual(err)) {
                    this.userTerminal.cancel();
                } else if (UserTerminalCloseError.isEqual(err) === false) {
                    this.userTerminal.error();
                    this.userTerminal.write(`${err}\n`, TerminalMessageStyle.error);
                }
            }

            if (err instanceof ExecutorTaskError) {
                if (isShowErrorEnabled()) {
                    const error = err as ExecutorTaskError;
                    vscode.window.showErrorMessage(error.message, "Show log").then(option => {
                        if (option === "Show log") {
                            error.terminal?.show();
                        }
                    });
                }
                throw err;
            } else if (err instanceof ExecutorTerminated) {
                throw err; // no need to notify as this's one is terminated by user
            } else if (err === E_CANCELED) {
                // lock was cancelled: do nothing
            } else if (err === UserTerminatedError) {
                throw err;
            } else {
                if ((err as Error).message) {
                    vscode.window.showErrorMessage((err as Error).message);
                }
                throw err;
            }
        } finally {
            this.latestOperationID.type = undefined;
            this._executingCommand = undefined;
            if (releaser) {
                releaser();
            }
        }
    }

    cancel() {
        this._prevCommandContext?.cancel();
    }
}
