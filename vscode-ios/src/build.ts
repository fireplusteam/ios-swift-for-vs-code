import * as vscode from 'vscode';
import { Executor } from "./execShell";
import { getEnv, getEnvFilePath, getScriptPath, getWorkspacePath } from "./env";
import { showPicker } from './inputPicker';
import { checkWorkspace } from "./commands";

export async function cleanDerivedData(executor: Executor) { 
    await executor.execShell("Clean Derived Data", "clean_derived_data.sh");
}

export function buildOptions(executor: Executor) {
    vscode.window.showQuickPick(["iOS: Build Selected Target", "iOS"]);
  executor.execShell("Clean Derived Data", "clean_derived_data.sh");
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
