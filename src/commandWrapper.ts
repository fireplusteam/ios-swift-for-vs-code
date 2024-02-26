import * as vscode from "vscode";
import { ExecutorRunningError, ExecutorTaskError } from "./execShell";
import { projectExecutor, sleep } from "./extension";

export async function runCommand(commandClosure: () => Promise<void>, successMessage: string | undefined = undefined) {
  try {
    await commandWrapper(commandClosure, successMessage);
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
    } else if (err instanceof ExecutorTaskError) {
      const error = err as ExecutorTaskError;
      vscode.window.showErrorMessage(error.message, "Show log")
        .then((option) => {
          if (option === "Show log") {
            error.terminal?.show();
          }
        });
      throw err;
    } else {
      if ((err as Error).message) {
        vscode.window.showErrorMessage((err as Error).message);
      }
      throw err;
    }
  }
}
