import * as vscode from "vscode";
import { Executor, ExecutorRunningError, ExecutorTaskError, ExecutorTerminatedByUserError } from "./execShell";
import { TerminatedDebugSessionTask } from "./DebugConfigurationProvider";
import { Mutex, MutexInterface, E_CANCELED } from "async-mutex";

export const UserCommandIsExecuting: Error = new Error("User task is currently executing");

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

    get executor(): Executor {
        return this._executor;
    }

    constructor(executor: Executor) {
        this._executor = executor;
    }

    async userCommandWithoutThrowingException(commandClosure: () => Promise<void>, successMessage: string | undefined = undefined) {
        try {
            await this.userCommand(commandClosure, successMessage);
        } catch (err) {
            // command wrapper shows an error, no more need to propagate it further
        }
    }

    async autoWatchCommand(commandClosure: () => Promise<void>) {
        if (this.latestOperationID.type == "user") {
            throw UserCommandIsExecuting;
        }
        this.latestOperationID = { id: this.latestOperationID.id + 1, type: "autowatcher" };
        const currentOperationID = this.latestOperationID;
        let release: MutexInterface.Releaser | undefined = undefined;
        try {
            if (this._mutex.isLocked()) {
                if (this._executingCommand == "autowatcher") {
                    this.executor.terminateShell();
                    this._mutex.cancel();
                } else {
                    throw UserCommandIsExecuting;
                }
            }
            release = await this._mutex.acquire();
            if (currentOperationID !== this.latestOperationID)
                throw E_CANCELED;
            this._executingCommand = "autowatcher";
            // perform async operations
            await this.executor.terminateShell();
            await commandClosure();
        } finally {
            this.latestOperationID.type = undefined;
            this._executingCommand = undefined;
            if (release)
                release();
        }
    }

    async userCommand(commandClosure: () => Promise<void>, successMessage: string | undefined = undefined) {
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
                    this._executor.terminateShell();
                    this._mutex.cancel();
                } else {
                    throw UserCommandIsExecuting;
                }
            }
            releaser = await this._mutex.acquire();
            if (currentOperationID !== this.latestOperationID)
                throw E_CANCELED;
            this._executingCommand = "user";
            // perform async operations
            await this._executor.terminateShell();
            await commandClosure();
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