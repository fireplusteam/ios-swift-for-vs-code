import { Executor } from "./execShell";
import { checkWorkspace, storeVSConfig } from "./commands";
import { emptyBuildLog } from './utils';
import { ProblemDiagnosticResolver } from './ProblemDiagnosticResolver';
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
        "Build",
        "build_app.sh",
        ["-TARGET"],
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