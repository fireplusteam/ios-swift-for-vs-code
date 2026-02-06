import * as vscode from "vscode";
import { buildSelectedTarget, cleanDerivedData } from "./buildCommands";
import { isActivated } from "./env";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { AtomicCommand } from "./CommandManagement/AtomicCommand";
import { CommandContext } from "./CommandManagement/CommandContext";
import { sleep } from "./utils";
import { AutocompleteWatcher } from "./BackgroundIndexing/AutocompleteWatcher";

interface BuildTaskDefinition extends vscode.TaskDefinition {
    command: string;
}

function isBuildTaskDefinition(
    definition: vscode.TaskDefinition
): definition is BuildTaskDefinition {
    return (
        definition.command !== undefined &&
        typeof definition.command === "string" &&
        definition.command.length > 0
    );
}

type BuildTaskType = "xcode" | "xcode-watch";

export class BuildTaskProvider implements vscode.TaskProvider {
    private problemResolver: ProblemDiagnosticResolver;
    private atomicCommand: AtomicCommand;

    constructor(
        private type: BuildTaskType,
        problemResolver: ProblemDiagnosticResolver,
        atomicCommand: AtomicCommand,
        private autocompleteWatcher: AutocompleteWatcher
    ) {
        this.type = type;
        this.problemResolver = problemResolver;
        this.atomicCommand = atomicCommand;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public async provideTasks(token?: vscode.CancellationToken): Promise<vscode.Task[]> {
        if ((await isActivated()) === false) {
            return [];
        }

        switch (this.type) {
            case "xcode":
                return [
                    this.createBuildTask(
                        "Build Selected Target",
                        "xcode",
                        "buildSelectedTarget",
                        vscode.TaskGroup.Build,
                        async context => {
                            await buildSelectedTarget(context, this.problemResolver);
                        }
                    ),
                    this.createBuildTask(
                        "Clean Derived Data",
                        "xcode",
                        "cleanDerivedData",
                        undefined,
                        async context => {
                            await cleanDerivedData(
                                context,
                                this.autocompleteWatcher.semanticManager
                            );
                        }
                    ),
                ];
            case "xcode-watch":
                return [
                    this.createBuildTask(
                        "Build For LSP Autocomplete",
                        "xcode-watch",
                        "buildForAutocomplete",
                        vscode.TaskGroup.Build,
                        async context => {
                            await this.autocompleteWatcher.triggerIncrementalBuild(
                                vscode.window.activeTextEditor?.document.uri,
                                {
                                    commandContext: context,
                                    includeTargets: [],
                                    excludeTargets: [],
                                }
                            );
                        }
                    ),
                ];
        }
    }

    private createBuildTask(
        title: string,
        type: BuildTaskType,
        command: string,
        group: vscode.TaskGroup | undefined,
        commandClosure: (context: CommandContext) => Promise<void>
    ) {
        const def: BuildTaskDefinition = {
            type: type,
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
            instanceLimit: 1,
            instancePolicy: "terminateOldest",
            reevaluateOnRerun: true,
        };
        return buildTask;
    }

    private isValidTask(task: vscode.Task): boolean {
        const taskDefinition = task.definition as vscode.TaskDefinition;
        return task.definition.type === this.type && isBuildTaskDefinition(taskDefinition);
    }

    public async resolveTask(
        task: vscode.Task,
        token?: vscode.CancellationToken
    ): Promise<vscode.Task | undefined> {
        if (this.isValidTask(task)) {
            const taskDefinition = task.definition as BuildTaskDefinition;
            if (this.atomicCommand.fetchingTasks) {
                /// atomic command is fetching tasks to get include/exclude targets for autocomplete build
                if (taskDefinition.type === "xcode-watch") {
                    // first task is resolved task, should be only one instance in a user config
                    if (this.atomicCommand.watcherTaskData === undefined) {
                        this.atomicCommand.watcherTaskData = {
                            includeTargets: taskDefinition.includeTargets ?? [],
                            excludeTargets: taskDefinition.excludeTargets ?? [],
                        };
                    }
                }
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
                                await this.autocompleteWatcher.triggerIncrementalBuild(
                                    vscode.window.activeTextEditor?.document.uri,
                                    {
                                        commandContext: context,
                                        includeTargets: taskDefinition.includeTargets ?? [],
                                        excludeTargets: taskDefinition.excludeTargets ?? [],
                                    }
                                );
                                break;
                            case "cleanDerivedData":
                                await cleanDerivedData(
                                    context,
                                    this.autocompleteWatcher.semanticManager
                                );
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
            if (this.atomicCommand.cancel()) {
                sleep(1000); // Give some time for previous task to cancel
            }
            if (token?.isCancellationRequested) {
                return Promise.reject("Task cancelled");
            }
            return new Promise<vscode.Pseudoterminal>(resolve => {
                this.atomicCommand.userCommand(
                    async context => {
                        await commandClosure(context);
                    },
                    title,
                    "", // no source as it's running via tasks
                    true,
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
