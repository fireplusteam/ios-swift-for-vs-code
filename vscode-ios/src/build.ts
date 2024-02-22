import * as vscode from 'vscode';
import { Executor, ExecutorReturnType } from "./execShell";
import { showPicker } from './inputPicker';
import { checkWorkspace, storeVSConfig } from "./commands";
import { getLastLine } from './utils';

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

export async function buildTestsForCurrentFile(executor: Executor) {
  await storeVSConfig(executor);
  await checkWorkspace(executor);
  
  let stdout = getLastLine((await executor.execShell(
    "Fetch Tests For currentFile",
    "populate_tests_of_current_file.sh",
    [],
    false,
    ExecutorReturnType.stdout
  )) as string);

  let option = await showPicker(
    stdout,
    "Tests",
    "Please select Tests",
    true
  );

  if (option === undefined || option === '') {
    throw Error("Tests are not picked");
  }

  await executor.execShell(
    "Build Tests",
    "build_app.sh",
    ["-TESTING_ONLY_TESTS", option],
    false
  );
}