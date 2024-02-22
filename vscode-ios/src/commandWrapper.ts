import * as vscode from "vscode";
import { ExecutorRunningError } from "./execShell";
import { projectExecutor, sleep } from "./extension";

export async function runCommand(commandClosure: () => Promise<void>) {
  try {
    await commandWrapper(commandClosure);
  } catch (err) {
    // command wrapper shows an error, no more need to propagate it further
  }
}

export async function commandWrapper(commandClosure: () => Promise<void>, successMessage: string | undefined = undefined) {
  try {
    await commandClosure();
    if (successMessage) {
      vscode.window.showInformationMessage(successMessage);
    }
  } catch (err) {
    if (err instanceof ExecutorRunningError) {
      const choice = await vscode.window.showErrorMessage(
        "To execute this task you need to terminate the current task. Do you want to terminate it to continue?",
        "Terminate",
        "Cancel"
      );
      if (choice === "Terminate") {
        projectExecutor.terminateShell();
        await sleep(1500); // 1.5 seconds
        await commandClosure();
      } else {
        throw err;
      }
    } else {
      if ((err as Error).message) {
        vscode.window.showErrorMessage((err as Error).message);
      }
      throw err;
    }
  }
}
