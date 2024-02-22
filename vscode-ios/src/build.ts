import * as vscode from 'vscode';
import { Executor } from "./execShell";
import { getEnv, getEnvFilePath, getScriptPath, getWorkspacePath } from "./env";
import { showPicker } from './inputPicker';
import { checkWorkspace } from "./commands";

export async function cleanDerivedData(executor: Executor) { 
    await executor.execShell("Clean Derived Data", "clean_derived_data.sh");
}

export async function buildSelectedTarget(executor: Executor) {
  await checkWorkspace(executor);
  await executor.execShell(
    "Build Selected Target",
    "build_app.sh",
    ["-TARGET"],
    false
  );
}

export async function buildAllTarget(executor: Executor) {
  await checkWorkspace(executor);
  await executor.execShell(
    "Build All",
    "build_app.sh",
    ["-ALL"],
    false
  );
}

export async function buildCurrentFile(executor: Executor) {
  await checkWorkspace(executor);
  const fileUrl = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (fileUrl === undefined) {
    throw new Error("In order to trigger a compile task for a file, select a file first please");
  }
  await executor.execShell(
    "Build: Current File",
    "compile_current_file.sh",
    [fileUrl],
    false
  );
}

// TESTS

export async function buildTests(executor: Executor) {
  await checkWorkspace(executor);
  await executor.execShell(
    "Build Tests",
    "build_app.sh",
    ["-TESTING"],
    false
  );
}