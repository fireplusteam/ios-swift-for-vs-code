import { checkWorkspace } from "./commands";
import { emptyBuildLog } from './utils';
import { ProblemDiagnosticResolver } from './ProblemDiagnosticResolver';
import { getWorkspacePath } from './env';
import path from 'path';
import { CommandContext } from "./CommandManagment/CommandContext";

export function getFileNameLog() {
    const fileName = path.join(".logs", "build.log");
    return fileName;
}

export async function cleanDerivedData(context: CommandContext) {
    await context.execShell("Clean Derived Data", "clean_derived_data.sh");
}

export async function buildSelectedTarget(context: CommandContext, problemResolver: ProblemDiagnosticResolver) {
    await checkWorkspace(context);
    emptyBuildLog();
    const filePath = getFileNameLog();
    problemResolver.parseAsyncLogs(getWorkspacePath(), filePath);
    await context.execShell(
        "Build",
        "build_app.sh",
        ["-TARGET"],
        false
    );
}

// TESTS

export async function buildTests(context: CommandContext, problemResolver: ProblemDiagnosticResolver) {
    await checkWorkspace(context);
    emptyBuildLog();
    const filePath = getFileNameLog();
    problemResolver.parseAsyncLogs(getWorkspacePath(), filePath);
    await context.execShell(
        "Build Tests",
        "build_app.sh",
        ["-TESTING"],
        false
    );
}

export async function buildTestsForCurrentFile(context: CommandContext, problemResolver: ProblemDiagnosticResolver, tests: string[]) {
    await checkWorkspace(context);
    const option = tests.map(e => {
        return `-only-testing:${e}`;
    }).join(" ");
    emptyBuildLog();
    const filePath = getFileNameLog();
    problemResolver.parseAsyncLogs(getWorkspacePath(), filePath);
    await context.execShell(
        "Build Tests",
        "build_app.sh",
        ["-TESTING_ONLY_TESTS", option],
        false
    );
}