import * as vscode from "vscode";
import { Executor, ExecutorReturnType } from "./execShell";

export async function selectTarget(executor: Executor) {
  let stdout = await executor.execShell("Fetch Project Targets", "populate_schemes.sh", [], false, ExecutorReturnType.stdout) as string;

  stdout = stdout.trim();
  const lines = stdout.split("\n");
  
  const items: vscode.QuickPickItem[] = JSON.parse(lines[lines.length - 1]); 
  let option = await vscode.window.showQuickPick<vscode.QuickPickItem>(items, {
    title: "Target",
    placeHolder: "Please select Target",
    canPickMany: false
  });

  if (option === undefined) {
    return false;
  }

  return await executor.execShell(
    "Update Selected Target",
    "update_enviroment.sh",
    ["-destinationScheme", option]
  );
}

export async function checkWorkspace(executor: Executor) {
  return await executor.execShell("Validate Environment", "check_workspace.sh");
}

export async function generateXcodeServer(executor: Executor) {
  if ((await checkWorkspace(executor)) === false) {
    return false;
  }
  return await executor.execShell(
    "Generate xCode Server",
    "build_autocomplete.sh"
  );
}

export async function buildSelectedTarget(executor: Executor) {
  if ((await checkWorkspace(executor)) === false) {
    return false;
  }
  return await executor.execShell(
    "Build Selected Target",
    "build_app.sh",
    ["-TARGET"],
    false
  );
}
