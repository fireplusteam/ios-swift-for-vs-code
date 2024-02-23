import * as vscode from 'vscode';
import { Executor, ExecutorMode, ExecutorReturnType } from "./execShell";
import { showPicker } from './inputPicker';
import { checkWorkspace, storeVSConfig } from "./commands";
import { getLastLine } from './utils';
import { ProblemDiagnosticResolver } from './ProblemDiagnosticResolver';
import fs from "fs";
import { getWorkspacePath } from './env';
import path from 'path';


async function findDiagnosticProblems(problemResolver: ProblemDiagnosticResolver) {
  const workPath = getWorkspacePath();
  try {

    const stdout = fs.readFileSync(path.join(workPath, ".logs", "build.log"), "utf-8");
    problemResolver.parseBuildLog(stdout);
  } catch (err) {
    console.log(err);
  }
}

export async function cleanDerivedData(executor: Executor) {
  await executor.execShell("Clean Derived Data", "clean_derived_data.sh");
}

export async function buildSelectedTarget(executor: Executor, problemResolver: ProblemDiagnosticResolver) {
  await checkWorkspace(executor);
  try {
    await executor.execShell(
      "Build Selected Target",
      "build_app.sh",
      ["-TARGET"],
      false
    );
  } finally {
    await findDiagnosticProblems( problemResolver);
  }
}

export async function buildAllTarget(executor: Executor, problemResolver: ProblemDiagnosticResolver) {
  await checkWorkspace(executor);
  try {
    await executor.execShell(
      "Build All",
      "build_app.sh",
      ["-ALL"],
      false
    );
  } finally {
    await findDiagnosticProblems(problemResolver);
  }
}

export async function buildCurrentFile(executor: Executor, problemResolver: ProblemDiagnosticResolver) {
  await checkWorkspace(executor);
  const fileUrl = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (fileUrl === undefined) {
    throw new Error("In order to trigger a compile task for a file, select a file first please");
  }
  try {
    await executor.execShell(
      "Build: Current File",
      "compile_current_file.sh",
      [fileUrl],
      false
    );
  } finally {
    await findDiagnosticProblems(problemResolver);
  }
}

// TESTS

export async function buildTests(executor: Executor, problemResolver: ProblemDiagnosticResolver) {
  await checkWorkspace(executor);
  try {
    await executor.execShell(
      "Build Tests",
      "build_app.sh",
      ["-TESTING"],
      false
    );
  } finally {
    await findDiagnosticProblems(problemResolver);
  }
}

export async function buildTestsForCurrentFile(executor: Executor, problemResolver: ProblemDiagnosticResolver) {
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
  try {
    await executor.execShell(
      "Build Tests",
      "build_app.sh",
      ["-TESTING_ONLY_TESTS", option],
      false
    );
  } finally {
    await findDiagnosticProblems(problemResolver);
  }
}