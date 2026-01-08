import * as vscode from "vscode";
import { ExecutorTaskError, ExecutorTerminated } from "../Executor";
import { Mutex, MutexInterface, E_CANCELED } from "async-mutex";
import { CommandContext, UserTerminalCloseError, UserTerminatedError } from "./CommandContext";
import { TerminalMessageStyle, TerminalShell } from "../TerminalShell";
import { LSPClientContext } from "../LSP/lspExtension";
import { CustomError } from "../utils";
import { getWorkspaceFolder } from "../env";
import { BundlePath } from "./BundlePath";
import { LogChannelInterface } from "../Logs/LogChannel";
import { ProjectManagerInterface } from "../ProjectManager/ProjectManager";
import { BuildTaskProvider } from "../BuildTaskProvider";

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
        private readonly projectManager: ProjectManagerInterface,
        private readonly log: LogChannelInterface
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
                this.projectManager,
                new BundlePath("autowatcher"),
                this.log
            );
            this._prevCommandContext = commandContext;
            const promiseResult = this.withCancellation(async () => {
                await commandClosure(commandContext);
            }, commandContext.cancellationToken);

            const taskDefinition: vscode.TaskDefinition = {
                type: BuildTaskProvider.BuildScriptType,
                command: "xcodeAgent",
            };

            this.userTerminal.terminalName = "Watcher";

            // execute as vscode task to have better terminal integration
            const task = new vscode.Task(
                taskDefinition,
                vscode.TaskScope.Workspace,
                "Watcher",
                "Xcode",
                new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
                    return this.watcherTerminal.createSudoTerminal(async () => {
                        // Your command logic here
                        await promiseResult;
                        this.watcherTerminal.success();
                    });
                })
            );
            task.group = vscode.TaskGroup.Build;
            await vscode.tasks.executeTask(task);
            return await promiseResult;
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

    async userCommand<T>(
        commandClosure: (commandContext: CommandContext) => Promise<T>,
        taskName: string | undefined,
        runFromTask: {
            shouldRunFromTask: boolean;
            onSudoTerminalCreated: (terminal: vscode.Pseudoterminal) => void;
        } = { shouldRunFromTask: false, onSudoTerminalCreated: () => {} }
    ) {
        this.latestOperationID = { id: this.latestOperationID.id + 1, type: "user" };
        const currentOperationID = this.latestOperationID;
        let releaser: MutexInterface.Releaser | undefined = undefined;
        try {
            if (this._mutex.isLocked()) {
                this._prevCommandContext?.cancel();
                this._mutex.cancel();
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
                this.projectManager,
                new BundlePath("bundle"),
                this.log
            );
            this._prevCommandContext = commandContext;
            const terminalName = taskName ? `User: ${taskName}` : "Xcode";

            const promiseResult = this.withCancellation(async () => {
                return await commandClosure(commandContext);
            }, commandContext.cancellationToken);

            if (runFromTask.shouldRunFromTask) {
                const pseudoTerminal = await this.userTerminal.createSudoTerminal(async () => {
                    // Your command logic here
                    await promiseResult;
                    if (taskName) {
                        this.userTerminal.success();
                    }
                });
                runFromTask.onSudoTerminalCreated(pseudoTerminal);
                return await promiseResult;
            }

            const taskDefinition: vscode.TaskDefinition = {
                type: BuildTaskProvider.BuildScriptType,
                command: "xcodeAgent",
            };

            this.userTerminal.terminalName = terminalName;

            // execute as vscode task to have better terminal integration
            await vscode.tasks.executeTask(
                new vscode.Task(
                    taskDefinition,
                    vscode.TaskScope.Workspace,
                    terminalName,
                    "Xcode",
                    new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
                        return this.userTerminal.createSudoTerminal(async () => {
                            // Your command logic here
                            await promiseResult;
                            if (taskName) {
                                this.userTerminal.success();
                            }
                        });
                    })
                )
            );
            return await promiseResult;
        } catch (err) {
            try {
                this.log.error(
                    `AtomicCommand: Error during executing user command ${taskName}, error: ${JSON.stringify(err)}`
                );
            } catch {
                /**/
            }
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
            } else if (err === UserTerminalCloseError) {
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
        if (this._mutex.isLocked()) {
            this._prevCommandContext?.cancel();
            this._prevCommandContext = undefined;
            return true;
        }
        return false;
    }
}
