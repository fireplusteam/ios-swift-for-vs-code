import * as vscode from "vscode";
import { Executor } from "./execShell";
import { buildSelectedTarget, cleanDerivedData } from "./build";
import { commandWrapper } from "./commandWrapper";
import { isActivated } from "./env";
import { TaskDefinition } from "vscode";

interface BuildTaskDefinition extends vscode.TaskDefinition {
    taskBuild: string;
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
        let buildSelectedTargetTask = this.createBuildTask(
            "Build Selected Target",
            async () => {
                await buildSelectedTarget(this.executor);
            }
        );

        let cleanTask = this.createBuildTask(
            "Clean Derived Data",
            async () => {
                await cleanDerivedData(this.executor);
            }
        );

        return [buildSelectedTargetTask, cleanTask];
    }

    private createBuildTask(title: string, commandClosure: () => Promise<void>) {
        const def: BuildTaskDefinition = { type: BuildTaskProvider.BuildScriptType, taskBuild: title };
        let buildTask = new vscode.Task(
            def,
            vscode.TaskScope.Workspace,
            title,
            "iOS",
            this.customExecution(commandClosure)
        );
        buildTask.group = vscode.TaskGroup.Build;
        buildTask.presentationOptions = {
            reveal: vscode.TaskRevealKind.Never,
            close: true
        };
        buildTask.isBackground = true;
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

    private customExecution(commandClosure: () => Promise<void>) {
        return new vscode.CustomExecution(() => {
            return new Promise((resolved) => {
                const writeEmitter = new vscode.EventEmitter<string>();
                const closeEmitter = new vscode.EventEmitter<number>();
                const pty: vscode.Pseudoterminal = {
                    open: async () => {
                        await commandWrapper(commandClosure);
                        closeEmitter.fire(0);
                    },
                    onDidWrite: writeEmitter.event,
                    onDidClose: closeEmitter.event,
                    close: () => {
                        this.executor.terminateShell();
                    },
                };
                resolved(pty);
            });
        });
    }
}
