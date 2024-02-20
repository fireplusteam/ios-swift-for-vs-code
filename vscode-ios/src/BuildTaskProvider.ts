import * as vscode from "vscode";
import { Executor } from "./execShell";
import { buildSelectedTarget, cleanDerivedData } from "./build";
import { close } from "fs";
import { commandWrapper } from "./commandWrapper";

export class BuildTaskProvider {
  private executor: Executor;

  constructor(executor: Executor) {
    this.executor = executor;
  }

  public provideTasks() {
    let buildSelectedTargetTask = this.createBuildTask(
      "Build Selected Target",
      async () => {
        await buildSelectedTarget(this.executor);
      }
    );

    let cleanTask = this.createBuildTask("Clean Derived Data", async () => {
      await cleanDerivedData(this.executor);
    });

    return [buildSelectedTargetTask, cleanTask];
  }

  private createBuildTask(title: string, commandClosure: () => Promise<void>) {
    let buildSelectedTargetTask = new vscode.Task(
      { type: "vscode-ios-tasks", name: title },
      vscode.TaskScope.Workspace,
      title,
      "iOS",
      this.customExecution(commandClosure)
    );
    buildSelectedTargetTask.group = vscode.TaskGroup.Build;
    buildSelectedTargetTask.presentationOptions = {
      reveal: vscode.TaskRevealKind.Never,
    };
    buildSelectedTargetTask.isBackground = true;
    return buildSelectedTargetTask;
  }

  public resolveTask(_task: any) {
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
