import * as vscode from "vscode";
import { ExecutorRunningError } from "./execShell";
import { projectExecutor, sleep } from "./extension";

export async function commandWrapper(commandClosure: () => Promise<void>) {
  try {
    await commandClosure();
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
        commandClosure();
      }
    }
  }
}
