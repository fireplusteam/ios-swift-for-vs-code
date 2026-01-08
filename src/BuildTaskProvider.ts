import * as vscode from "vscode";
import { buildAutocomplete, buildSelectedTarget, cleanDerivedData } from "./buildCommands";
import { isActivated } from "./env";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { AtomicCommand } from "./CommandManagement/AtomicCommand";
import { CommandContext } from "./CommandManagement/CommandContext";
import { TerminalShell } from "./TerminalShell";
import { sleep } from "./utils";

export async function executeTask(name: string) {
    const tasks = await vscode.tasks.fetchTasks();
    for (const task of tasks) {
        if (task.name === name && task.definition.type === BuildTaskProvider.BuildScriptType) {
            let disposable: vscode.Disposable;
            await new Promise(async (resolve, reject) => {
                disposable = vscode.tasks.onDidEndTaskProcess(e => {
                    if (e.execution.task.name === name) {
                        disposable.dispose();
                        if (e.exitCode !== 0) {
                            reject(Error(`Task ${name} failed with ${e.exitCode}`));
                            return;
                        }
                        resolve(true);
                    }
                });
                try {
                    await vscode.tasks.executeTask(task);
                } catch (err) {
                    reject(err);
                }
            });
        }
    }
}

export class BuildTaskProvider implements vscode.TaskProvider {
    static BuildScriptType = "xcode";

    private problemResolver: ProblemDiagnosticResolver;
    private atomicCommand: AtomicCommand;

    constructor(problemResolver: ProblemDiagnosticResolver, atomicCommand: AtomicCommand) {
        this.problemResolver = problemResolver;
        this.atomicCommand = atomicCommand;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public async provideTasks(token?: vscode.CancellationToken): Promise<vscode.Task[]> {
        if ((await isActivated()) === false) {
            return [];
        }

        const buildSelectedTargetTask = this.createBuildTask(
            "Build Selected Target",
            "buildSelectedTarget",
            vscode.TaskGroup.Build,
            async context => {
                await buildSelectedTarget(context, this.problemResolver);
            }
        );

        const buildAutocompleteTask = this.createBuildTask(
            "Build For LSP Autocomplete",
            "buildForAutocomplete",
            vscode.TaskGroup.Build,
            async context => {
                await buildAutocomplete(context, this.problemResolver);
            }
        );

        const cleanTask = this.createBuildTask(
            "Clean Derived Data",
            "cleanDerivedData",
            vscode.TaskGroup.Clean,
            async context => {
                await cleanDerivedData(context);
            }
        );

        return [buildAutocompleteTask, buildSelectedTargetTask, cleanTask];
    }

    private createBuildTask(
        title: string,
        command: string,
        group: vscode.TaskGroup,
        commandClosure: (context: CommandContext) => Promise<void>
    ) {
        const def: vscode.TaskDefinition = {
            type: BuildTaskProvider.BuildScriptType,
            command: command,
        };
        const buildTask = new vscode.Task(
            def,
            vscode.TaskScope.Workspace,
            title,
            "xcode",
            this.customExecution(`Xcode: ${title}`, commandClosure, undefined, true)
        );
        buildTask.group = group;
        buildTask.presentationOptions = {
            reveal: vscode.TaskRevealKind.Never,
            close: true,
        };
        if (group === vscode.TaskGroup.Build) {
            buildTask.problemMatchers = ["$xcode"];
        } else {
            buildTask.isBackground = true;
        }
        return buildTask;
    }

    public async resolveTask(
        task: vscode.Task,
        token?: vscode.CancellationToken
    ): Promise<vscode.Task | undefined> {
        const taskDefinition = task.definition;
        if (taskDefinition.type === BuildTaskProvider.BuildScriptType) {
            let wasExecuting = false;
            while (this.activeCommand.isExecuting) {
                if (!this.activeCommand.context?.cancellationToken.isCancellationRequested) {
                    this.activeCommand.context?.cancel();
                }
                wasExecuting = true;
                await sleep(100);
            }
            if (wasExecuting) {
                await sleep(500);
            }
            const newTask = new vscode.Task(
                task.definition,
                task.scope ?? vscode.TaskScope.Workspace,
                task.name,
                task.source,
                this.customExecution(
                    `${task.name}`,
                    async context => {
                        switch (taskDefinition.command) {
                            case "buildSelectedTarget":
                                await buildSelectedTarget(context, this.problemResolver);
                                break;
                            case "buildForAutocomplete":
                                await buildAutocomplete(context, this.problemResolver);
                                break;
                            case "cleanDerivedData":
                                await cleanDerivedData(context);
                                break;
                        }
                    },
                    token,
                    false
                ),
                task.problemMatchers
            );
            newTask.presentationOptions = task.presentationOptions;

            return newTask;
        }
        return undefined;
    }

    private activeCommand: { context: CommandContext | null; isExecuting: boolean } = {
        context: null,
        isExecuting: false,
    };

    private customExecution(
        successMessage: string,
        commandClosure: (context: CommandContext) => Promise<void>,
        token: vscode.CancellationToken | undefined,
        isDefaultDefined: boolean
    ) {
        return new vscode.CustomExecution(() => {
            if (token?.isCancellationRequested) {
                return Promise.reject("Task cancelled");
            }

            return new Promise(resolved => {
                this.activeCommand.isExecuting = true;

                const writeEmitter = new vscode.EventEmitter<string>();
                const closeEmitter = new vscode.EventEmitter<number>();
                const didChangeNameEmitter = new vscode.EventEmitter<string>();
                let commandContext: CommandContext | undefined = undefined;
                let disposable: vscode.Disposable | undefined;
                const pty: vscode.Pseudoterminal = {
                    open: async () => {
                        if (isDefaultDefined) {
                            closeEmitter.fire(0); // this's a workaround to hide a task terminal as soon as possible to let executor terminal to do the main job. That has a side effect if that task would be used in a chain of tasks, then it's finished before process actually finishes
                        }

                        try {
                            await this.atomicCommand.userCommand(
                                async context => {
                                    this.activeCommand.context = context;
                                    if (!isDefaultDefined && context.terminal) {
                                        context.setTerminal(
                                            new TerminalShell("Build_Internal_Terminal", false)
                                        );
                                        context.terminal.terminalName = successMessage;
                                        context.terminal.bindToOutputEmitter(writeEmitter);
                                    }

                                    disposable = token?.onCancellationRequested(() => {
                                        context.cancel();
                                        disposable?.dispose();
                                    });
                                    commandContext = context;
                                    await commandClosure(context);
                                },
                                isDefaultDefined ? successMessage.replace("Xcode: ", "") : undefined
                            );
                            if (!isDefaultDefined) {
                                closeEmitter.fire(0);
                            }
                        } catch (err) {
                            /* empty */
                            if (!isDefaultDefined) {
                                closeEmitter.fire(1);
                            }
                        } finally {
                            disposable?.dispose();
                            this.activeCommand.isExecuting = false;
                        }
                    },
                    onDidChangeName: didChangeNameEmitter.event,
                    onDidWrite: writeEmitter.event,
                    onDidClose: closeEmitter.event,
                    close: async () => {
                        commandContext?.cancel();
                        this.activeCommand.isExecuting = false;
                    },
                };

                if (isDefaultDefined) {
                    closeEmitter.fire(0); // this's a workaround to hide a task terminal as soon as possible to let executor terminal to do the main job. That has a side effect if that task would be used in a chain of tasks, then it's finished before process actually finishes
                }
                resolved(pty);
            });
        });
    }
}
