import * as vscode from "vscode";
import { Executor, ExecutorMode, ExecutorReturnType } from "./execShell";
import { buildAllTarget, buildCurrentFile, buildSelectedTarget, buildTests, buildTestsForCurrentFile, cleanDerivedData } from "./build";
import { commandWrapper } from "./commandWrapper";
import { isActivated } from "./env";
import { TaskDefinition } from "vscode";
import { title } from "process";
import { getLastLine } from "./utils";
import { log } from "console";

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
                        if (e.exitCode !== 0) {
                            reject(new Error(`Task ${name} failed with ${e.exitCode}`));
                            return;
                        }
                        resolve(true);
                    }
                });
                await vscode.tasks.executeTask(task);
            });
        }
    }
}

export class BuildTaskProvider implements vscode.TaskProvider {
    static BuildScriptType = 'vscode-ios-tasks';

    private executor: Executor;

    constructor(executor: Executor) {
        this.executor = executor;
    }

    public provideTasks(token?: vscode.CancellationToken): vscode.ProviderResult<vscode.Task[]> {
        if (!isActivated()) {
            return [];
        }

        let buildAllTask = this.createBuildTask(
            "Build All",
            vscode.TaskGroup.Build,
            async () => {
                await buildAllTarget(this.executor);
            }
        );

        let buildCurrentFileTask = this.createBuildTask(
            "Build: Current File",
            vscode.TaskGroup.Build,
            async () => {
                await buildCurrentFile(this.executor);
            }
        );

        let buildSelectedTargetTask = this.createBuildTask(
            "Build Selected Target",
            vscode.TaskGroup.Build,
            async () => {
                await buildSelectedTarget(this.executor);
            }
        );

        let buildTestsTask = this.createBuildTask(
            "Build Tests",
            vscode.TaskGroup.Build,
            async () => {
                await buildTests(this.executor);
            }
        );

        let buildTestsForCurrentFileTask = this.createBuildTask(
            "Build Tests: Current File",
            vscode.TaskGroup.Build,
            async () => {
                await buildTestsForCurrentFile(this.executor);
            }
        );

        let cleanTask = this.createBuildTask(
            "Clean Derived Data",
            vscode.TaskGroup.Clean,
            async () => {
                await cleanDerivedData(this.executor);
            }
        );

        return [buildTestsForCurrentFileTask, buildTestsTask, buildCurrentFileTask, buildAllTask, buildSelectedTargetTask, cleanTask];
    }

    private createBuildTask(title: string, group: vscode.TaskGroup, commandClosure: () => Promise<void>) {
        const def: BuildTaskDefinition = { type: BuildTaskProvider.BuildScriptType, taskBuild: title };
        let buildTask = new vscode.Task(
            def,
            vscode.TaskScope.Workspace,
            title,
            "iOS",
            this.customExecution(`iOS: ${title}`, commandClosure)
        );
        buildTask.group = group;
        buildTask.presentationOptions = {
            reveal: vscode.TaskRevealKind.Never,
            close: true
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

    private customExecution(successMessage: string, commandClosure: () => Promise<void>) {
        return new vscode.CustomExecution(() => {
            return new Promise((resolved) => {
                const writeEmitter = new vscode.EventEmitter<string>();
                const closeEmitter = new vscode.EventEmitter<number>();
                const pty: vscode.Pseudoterminal = {
                    open: async () => {
                        try {
                            await commandWrapper(commandClosure, successMessage);
                        } catch (err) {
                        }
                        const stdout =
                            await this.executor.execShell(
                                "Print Errors",
                                "print_errors.py",
                                ["-problemMatcher"],
                                false,
                                ExecutorReturnType.stdout,
                                ExecutorMode.silently
                            ) as string;
                        writeEmitter.fire(stdout);
                        closeEmitter.fire(0);
                    },
                    onDidWrite: writeEmitter.event,
                    onDidClose: closeEmitter.event,
                    close: async () => {
                        this.executor.terminateShell();
                    },
                };
                resolved(pty);
            });
        });
    }
}
