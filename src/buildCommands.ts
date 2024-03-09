import * as vscode from 'vscode';
import { Executor, ExecutorMode, ExecutorReturnType } from "./execShell";
import { showPicker } from './inputPicker';
import { checkWorkspace, storeVSConfig } from "./commands";
import { emptyBuildLog, emptyFile, getLastLine } from './utils';
import { ProblemDiagnosticResolver } from './ProblemDiagnosticResolver';
import fs from "fs";
import { getWorkspacePath } from './env';
import path from 'path';

export function getFileNameLog() {
    const fileName = path.join(".logs", "build.log");
    return fileName;
}

export async function cleanDerivedData(executor: Executor) {
    await executor.execShell("Clean Derived Data", "clean_derived_data.sh");
}

export async function buildSelectedTarget(executor: Executor, problemResolver: ProblemDiagnosticResolver) {
    await checkWorkspace(executor);
    emptyBuildLog();
    const filePath = getFileNameLog();
    problemResolver.parseAsyncLogs(getWorkspacePath(), filePath);
    await executor.execShell(
        "Build Selected Target",
        "build_app.sh",
        ["-TARGET"],
        false
    );
}

export async function buildAllTarget(executor: Executor, problemResolver: ProblemDiagnosticResolver) {
    await checkWorkspace(executor);
    emptyBuildLog();
    const filePath = getFileNameLog();
    problemResolver.parseAsyncLogs(getWorkspacePath(), filePath);
    await executor.execShell(
        "Build All",
        "build_app.sh",
        ["-ALL"],
        false
    );
}

export async function buildCurrentFile(executor: Executor, problemResolver: ProblemDiagnosticResolver) {
    await checkWorkspace(executor);
    const fileUrl = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (fileUrl === undefined) {
        throw new Error("In order to trigger a compile task for a file, select a file first please");
    }
    emptyBuildLog();
    const filePath = getFileNameLog();
    problemResolver.parseAsyncLogs(getWorkspacePath(), filePath, );
    await executor.execShell(
        "Build: Current File",
        "compile_current_file.sh",
        [fileUrl],
        false
    );
}

// TESTS

export async function buildTests(executor: Executor, problemResolver: ProblemDiagnosticResolver) {
    await checkWorkspace(executor);
    emptyBuildLog();
    const filePath = getFileNameLog();
    problemResolver.parseAsyncLogs(getWorkspacePath(), filePath);
    await executor.execShell(
        "Build Tests",
        "build_app.sh",
        ["-TESTING"],
        false
    );
}

export async function buildTestsForCurrentFile(executor: Executor, problemResolver: ProblemDiagnosticResolver, tests: string[]) {
    await storeVSConfig(executor);
    await checkWorkspace(executor);
    const option = tests.map(e => {
        return `-only-testing:${e}`;
    }).join(" ");
    emptyBuildLog();
    const filePath = getFileNameLog();
    problemResolver.parseAsyncLogs(getWorkspacePath(), filePath);
    await executor.execShell(
        "Build Tests",
        "build_app.sh",
        ["-TESTING_ONLY_TESTS", option],
        false
    );
}