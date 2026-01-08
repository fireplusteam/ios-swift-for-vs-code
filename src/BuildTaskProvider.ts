import * as vscode from "vscode";
import { buildAutocomplete, buildSelectedTarget, cleanDerivedData } from "./buildCommands";
import { isActivated } from "./env";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { AtomicCommand } from "./CommandManagement/AtomicCommand";
import { CommandContext } from "./CommandManagement/CommandContext";
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
            "Xcode",
            this.customExecution(title, commandClosure, undefined)
        );
        buildTask.group = group;
        buildTask.presentationOptions = {
            reveal: vscode.TaskRevealKind.Never,
            close: false,
        };
        if (group === vscode.TaskGroup.Build) {
            buildTask.problemMatchers = ["$xcode"];
        } else {
            buildTask.isBackground = true;
        }
        (buildTask.runOptions as any) = {
            // instanceLimit: 1,
            instancePolicy: "terminateOldest",
            reevaluateOnRerun: true,
        };
        return buildTask;
    }

    public async resolveTask(
        task: vscode.Task,
        token?: vscode.CancellationToken
    ): Promise<vscode.Task | undefined> {
        const taskDefinition = task.definition;
        if (taskDefinition.type === BuildTaskProvider.BuildScriptType) {
            if (this.atomicCommand.cancel()) {
                sleep(1000); // Give some time for previous task to cancel
            }

            const newTask = new vscode.Task(
                task.definition,
                task.scope ?? vscode.TaskScope.Workspace,
                task.name,
                task.source,
                this.customExecution(
                    task.name,
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
                    token
                ),
                task.problemMatchers
            );
            newTask.presentationOptions = task.presentationOptions;

            return newTask;
        }
        return undefined;
    }

    private customExecution(
        title: string,
        commandClosure: (context: CommandContext) => Promise<void>,
        token: vscode.CancellationToken | undefined
    ) {
        return new vscode.CustomExecution((): Promise<vscode.Pseudoterminal> => {
            if (token?.isCancellationRequested) {
                return Promise.reject("Task cancelled");
            }
            return new Promise<vscode.Pseudoterminal>(resolve => {
                this.atomicCommand.userCommand(
                    async context => {
                        await commandClosure(context);
                    },
                    title,
                    {
                        shouldRunFromTask: true,
                        onSudoTerminalCreated: terminal => {
                            resolve(terminal);
                        },
                    }
                );
            });
        });
    }
}
