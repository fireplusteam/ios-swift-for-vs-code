import * as vscode from "vscode";
import { buildSelectedTarget, buildTestsForCurrentFile, cleanDerivedData } from "./buildCommands";
import { isActivated } from "./env";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { AtomicCommand } from "./CommandManagement/AtomicCommand";
import { CommandContext } from "./CommandManagement/CommandContext";

interface BuildTaskDefinition extends vscode.TaskDefinition {
    taskBuild: string;
}

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
    static BuildScriptType = "vscode-ios-tasks";

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
            "Build",
            vscode.TaskGroup.Build,
            async context => {
                await buildSelectedTarget(context, this.problemResolver);
            }
        );

        const buildTestsTask = this.createBuildTask(
            "Build Tests",
            vscode.TaskGroup.Build,
            async context => {
                await buildTestsForCurrentFile(context, this.problemResolver, [], false);
            }
        );

        const cleanTask = this.createBuildTask(
            "Clean Derived Data",
            vscode.TaskGroup.Clean,
            async context => {
                await cleanDerivedData(context);
            }
        );

        return [buildTestsTask, buildSelectedTargetTask, cleanTask];
    }

    private createBuildTask(
        title: string,
        group: vscode.TaskGroup,
        commandClosure: (context: CommandContext) => Promise<void>
    ) {
        const def: BuildTaskDefinition = {
            type: BuildTaskProvider.BuildScriptType,
            taskBuild: title,
        };
        const buildTask = new vscode.Task(
            def,
            vscode.TaskScope.Workspace,
            title,
            "iOS",
            this.customExecution(`Xcode: ${title}`, commandClosure)
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

    public resolveTask(_task: vscode.Task) {
        const taskBuild = _task.definition.taskBuild;
        if (taskBuild) {
            // TODO: Implement resolver so a user can add tasks in his Task.json file
            //const definition: BuildTaskDefinition = <any>_task.definition;
            //return this.getTask(definition.flavor, definition.flags ? definition.flags : [], definition);
            console.log(taskBuild);
        }
        return undefined;
    }

    private customExecution(
        successMessage: string,
        commandClosure: (context: CommandContext) => Promise<void>
    ) {
        return new vscode.CustomExecution(() => {
            return new Promise(resolved => {
                const writeEmitter = new vscode.EventEmitter<string>();
                const closeEmitter = new vscode.EventEmitter<number>();
                let commandContext: CommandContext | undefined = undefined;
                const pty: vscode.Pseudoterminal = {
                    open: async () => {
                        closeEmitter.fire(0); // this's a workaround to hide a task terminal as soon as possible to let executor terminal to do the main job. That has a side effect if that task would be used in a chain of tasks, then it's finished before process actually finishes
                        try {
                            await this.atomicCommand.userCommand(async context => {
                                commandContext = context;
                                await commandClosure(context);
                            }, successMessage);
                        } catch (err) {
                            /* empty */
                        }
                    },
                    onDidWrite: writeEmitter.event,
                    onDidClose: closeEmitter.event,
                    close: async () => {
                        commandContext?.cancel();
                    },
                };
                resolved(pty);
            });
        });
    }
}
