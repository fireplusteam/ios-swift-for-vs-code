import * as vscode from 'vscode';
import { Executor } from "./execShell";

export async function checkWorkspace(executor: Executor) { 
    return await executor.execShell("Validate Environment", "check_workspace.sh");
}

export async function generateXcodeServer(executor: Executor) {
    if (await checkWorkspace(executor) === false) {
        return false;
    }
    return await executor.execShell("Generate xCode Server", "build_autocomplete.sh");
}

export async function buildSelectedTarget(executor: Executor) {
  if ((await checkWorkspace(executor)) === false) {
    return false;
  }
  return await executor.execShell(
    "Build Selected Target",
    "build_app.sh",
    false,
    ["-TARGET"]
  );
}