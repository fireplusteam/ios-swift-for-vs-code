import * as vscode from "vscode";
import { ExecutorTaskError, ExecutorTerminated } from "../Executor";
import { Mutex, MutexInterface, E_CANCELED } from "async-mutex";
import { CommandContext, UserTerminalCloseError, UserTerminatedError } from "./CommandContext";
import { TerminalMessageStyle, TerminalShell } from "../TerminalShell";
import { LSPClientContext } from "../LSP/lspExtension";
import { CustomError } from "../utils";
import { BundlePath } from "./BundlePath";
import { LogChannelInterface } from "../Logs/LogChannel";
import { ProjectManagerInterface } from "../ProjectManager/ProjectManager";

export const UserCommandIsExecuting = new CustomError("User task is currently executing");

export interface WatcherTaskData {
    includeTargets: string[];
    excludeTargets: string[];
}
export class AtomicCommand {
    private _mutex = new Mutex();
    private _executingCommand: "user" | "autowatcher" | undefined = undefined;
    private latestOperationID: { id: number; type: "user" | "autowatcher" | undefined } = {
        id: 0,
        type: undefined,
    };
    private _prevCommandContext?: CommandContext;

    private _fetchingTasks = false;

    get fetchingTasks() {
        return this._fetchingTasks;
    }

    private _watcherTaskData: WatcherTaskData | undefined = undefined;
    set watcherTaskData(data: WatcherTaskData | undefined) {
        this._watcherTaskData = data;
    }

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

    async autoWatchCommand(
        commandClosure: (
            commandContext: CommandContext,
            includeTargets: string[],
            excludeTargets: string[]
        ) => Promise<void>
    ) {
        const watcherTerminal = new TerminalShell("Watcher", "Xcode");

        if (this.latestOperationID.type === "user") {
            throw UserCommandIsExecuting;
        }
        this.latestOperationID = { id: this.latestOperationID.id + 1, type: "autowatcher" };
        const currentOperationID = this.latestOperationID;
        let release: MutexInterface.Releaser | undefined = undefined;
        let commandContext: CommandContext | undefined = undefined;
        try {
            if (this._mutex.isLocked()) {
                if (this._executingCommand === "autowatcher") {
                    this._prevCommandContext?.dispose();
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
            commandContext = new CommandContext(
                new vscode.CancellationTokenSource(),
                watcherTerminal,
                this.lspClient,
                this.projectManager,
                new BundlePath("autowatcher"),
                this.log
            );
            this._prevCommandContext = commandContext;

            this._fetchingTasks = true;
            this._watcherTaskData = undefined;

            const includeTargets: string[] = [];
            const excludeTargets: string[] = [];
            try {
                await vscode.tasks.fetchTasks({
                    type: "xcode-watch",
                });
                if (this._watcherTaskData !== undefined) {
                    // workaround for TS not recognizing that _watcherTaskData is set in BuildTaskProvider
                    const vals = this._watcherTaskData as any;
                    includeTargets.push(...vals.includeTargets);
                    excludeTargets.push(...vals.excludeTargets);
                }
            } finally {
                this._fetchingTasks = false;
            }

            const promiseResult = this.withCancellation(async () => {
                if (commandContext === undefined) {
                    throw new Error("Command context is undefined");
                }
                await commandClosure(commandContext, includeTargets, excludeTargets);
            }, commandContext.cancellationToken);

            const taskDefinition: vscode.TaskDefinition = {
                type: "xcode",
                command: "xcodeAgent",
            };

            // execute as vscode task to have better terminal integration
            const task = new vscode.Task(
                taskDefinition,
                vscode.TaskScope.Workspace,
                "Watcher",
                "Xcode",
                new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
                    return watcherTerminal.createSudoTerminalForTask(async () => {
                        // Your command logic here
                        await promiseResult;
                        watcherTerminal.success();
                    });
                })
            );
            task.group = vscode.TaskGroup.Build;
            await vscode.tasks.executeTask(task);
            return await promiseResult;
        } catch (error) {
            if (error !== UserCommandIsExecuting) {
                if (UserTerminatedError.isEqual(error)) {
                    watcherTerminal.cancel();
                } else if (UserTerminalCloseError.isEqual(error) === false) {
                    watcherTerminal.error();
                }
                watcherTerminal.write(`${error}\n`, TerminalMessageStyle.error);
            }
            throw error;
        } finally {
            this.latestOperationID.type = undefined;
            this._executingCommand = undefined;
            if (release) {
                release();
            }
            commandContext?.dispose();
        }
    }

    async userCommand<T>(
        commandClosure: (commandContext: CommandContext) => Promise<T>,
        taskName: string | undefined,
        taskSource: string | undefined = undefined,
        runFromTask: {
            shouldRunFromTask: boolean;
            onSudoTerminalCreated: (terminal: vscode.Pseudoterminal) => void;
        } = { shouldRunFromTask: false, onSudoTerminalCreated: () => {} }
    ) {
        const terminalName = taskName ? taskName : "Xcode";
        const userTerminal = new TerminalShell(terminalName, taskSource ?? "Xcode");

        this.latestOperationID = { id: this.latestOperationID.id + 1, type: "user" };
        const currentOperationID = this.latestOperationID;
        let releaser: MutexInterface.Releaser | undefined = undefined;
        let commandContext: CommandContext | undefined = undefined;
        try {
            if (this._mutex.isLocked()) {
                this._prevCommandContext?.dispose();
                this._mutex.cancel();
            }
            releaser = await this._mutex.acquire();
            if (currentOperationID !== this.latestOperationID) {
                throw E_CANCELED;
            }
            this._executingCommand = "user";
            commandContext = new CommandContext(
                new vscode.CancellationTokenSource(),
                userTerminal,
                this.lspClient,
                this.projectManager,
                new BundlePath("bundle"),
                this.log
            );
            this._prevCommandContext = commandContext;

            const promiseResult = this.withCancellation(async () => {
                if (commandContext === undefined) {
                    throw new Error("Command context is undefined");
                }
                return await commandClosure(commandContext);
            }, commandContext.cancellationToken);

            userTerminal.terminalName = terminalName;

            if (runFromTask.shouldRunFromTask) {
                const pseudoTerminal = await userTerminal.createSudoTerminalForTask(async () => {
                    await promiseResult;
                    userTerminal.success();
                });
                runFromTask.onSudoTerminalCreated(pseudoTerminal);
                return await promiseResult;
            }

            const taskDefinition: vscode.TaskDefinition = {
                type: "xcode-watch",
                command: "buildForAutocomplete",
            };

            // execute as vscode task to have better terminal integration
            await vscode.tasks.executeTask(
                new vscode.Task(
                    taskDefinition,
                    vscode.TaskScope.Workspace,
                    terminalName,
                    "Xcode",
                    new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
                        return userTerminal.createSudoTerminalForTask(async () => {
                            await promiseResult;
                            userTerminal.success();
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
                    userTerminal.cancel();
                } else if (UserTerminalCloseError.isEqual(err) === false) {
                    userTerminal.error();
                    userTerminal.write(`${err}\n`, TerminalMessageStyle.error);
                }
            }

            if (err instanceof ExecutorTaskError) {
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
            commandContext?.dispose();
        }
    }

    cancel() {
        if (this._mutex.isLocked()) {
            this._prevCommandContext?.dispose();
            this._prevCommandContext = undefined;
            return true;
        }
        return false;
    }
}
