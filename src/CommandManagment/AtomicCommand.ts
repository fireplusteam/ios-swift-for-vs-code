import * as vscode from "vscode";
import { Executor, ExecutorRunningError, ExecutorTaskError, ExecutorTerminatedByUserError } from "../execShell";
import { TerminatedDebugSessionTask } from "../Debug/DebugConfigurationProvider";
import { Mutex, MutexInterface, E_CANCELED } from "async-mutex";
import { CommandContext } from "./CommandContext";
import { error } from "console";

export const UserCommandIsExecuting: Error = new Error("User task is currently executing");
export const UserTerminatedError: Error = new Error("Terminated");

function isShowErrorEnabled() {
    const isEnabled = vscode.workspace.getConfiguration("vscode-ios").get("show.log");
    if (!isEnabled) {
        return false;
    }
    return true;
}

function shouldAskTerminateCurrentTask() {
    const isEnabled = vscode.workspace.getConfiguration("vscode-ios").get("confirm.terminate.task");
    if (!isEnabled) {
        return false;
    }
    return true;
}

export class AtomicCommand {
    private _mutex = new Mutex();
    private _executor: Executor;
    private _executingCommand: "user" | "autowatcher" | undefined = undefined;
    private latestOperationID: { id: number, type: "user" | "autowatcher" | undefined } = { id: 0, type: undefined };
    private _prevCommandContext?: CommandContext

    constructor(executor: Executor) {
        this._executor = executor;
    }

    async userCommandWithoutThrowingException(commandClosure: (commandContext: CommandContext) => Promise<void>, successMessage: string | undefined = undefined) {
        try {
            await this.userCommand(commandClosure, successMessage);
        } catch (err) {
            // command wrapper shows an error, no more need to propagate it further
        }
    }

    async autoWatchCommand(commandClosure: (commandContext: CommandContext) => Promise<void>) {
        if (this.latestOperationID.type == "user") {
            throw UserCommandIsExecuting;
        }
        this.latestOperationID = { id: this.latestOperationID.id + 1, type: "autowatcher" };
        const currentOperationID = this.latestOperationID;
        let release: MutexInterface.Releaser | undefined = undefined;
        try {
            if (this._mutex.isLocked()) {
                if (this._executingCommand == "autowatcher") {
                    this._prevCommandContext?.cancellationToken.cancel();
                    this._mutex.cancel();
                } else {
                    throw UserCommandIsExecuting;
                }
            } else {
                this._prevCommandContext?.cancellationToken.cancel();
            }
            release = await this._mutex.acquire();
            if (currentOperationID !== this.latestOperationID)
                throw E_CANCELED;
            this._executingCommand = "autowatcher";
            const commandContext = new CommandContext(new vscode.CancellationTokenSource(), this._executor);
            this._prevCommandContext = commandContext;
            await this.withCancellation(async () => {
                await commandClosure(commandContext);
            }, commandContext.cancellationToken);
        } finally {
            this.latestOperationID.type = undefined;
            this._executingCommand = undefined;
            if (release)
                release();
        }
    }

    async withCancellation(closure: () => Promise<void>, cancellation: vscode.CancellationTokenSource) {
        let dis: vscode.Disposable;
        return new Promise<void>(async (resolve, reject) => {
            dis = cancellation.token.onCancellationRequested(e => {
                reject(UserTerminatedError);
                dis.dispose();
            })
            resolve(await closure());
        });
    }

    async userCommand(commandClosure: (commandContext: CommandContext) => Promise<void>, successMessage: string | undefined = undefined) {
        this.latestOperationID = { id: this.latestOperationID.id + 1, type: "user" };
        const currentOperationID = this.latestOperationID;
        let releaser: MutexInterface.Releaser | undefined = undefined;
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
                    this._prevCommandContext?.cancellationToken.cancel();
                    this._mutex.cancel();
                } else {
                    throw UserCommandIsExecuting;
                }
            } else {
                this._prevCommandContext?.cancellationToken.cancel();
            }
            releaser = await this._mutex.acquire();
            if (currentOperationID !== this.latestOperationID)
                throw E_CANCELED;
            this._executingCommand = "user";
            const commandContext = new CommandContext(new vscode.CancellationTokenSource(), this._executor);
            this._prevCommandContext = commandContext;
            await this.withCancellation(async () => {
                await commandClosure(commandContext);
            }, commandContext.cancellationToken);
            if (successMessage) {
                vscode.window.showInformationMessage(successMessage);
            }
        } catch (err) {
            if (err instanceof ExecutorRunningError) {
                throw err;
            } else if (err instanceof ExecutorTaskError) {
                if (isShowErrorEnabled()) {
                    const error = err as ExecutorTaskError;
                    vscode.window.showErrorMessage(error.message, "Show log")
                        .then((option) => {
                            if (option === "Show log") {
                                error.terminal?.show();
                            }
                        });
                }
                throw err;
            } else if (err instanceof ExecutorTerminatedByUserError) {
                throw err; // no need to notify as this's one is terminated by user
            } else if (err instanceof TerminatedDebugSessionTask) {
                throw err;
            } else if (err == E_CANCELED) {
                // lock was cancelled: do nothing
                // } else if (err == UserTerminatedError) {
                //     // terminated by a user
            } else {
                if ((err as Error).message) {
                    vscode.window.showErrorMessage((err as Error).message);
                }
                throw err;
            }
        } finally {
            this.latestOperationID.type = undefined;
            this._executingCommand = undefined;
            if (releaser)
                releaser()
        }
    }
}