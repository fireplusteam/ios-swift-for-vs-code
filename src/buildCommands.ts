import { checkWorkspace } from "./commands";
import { emptyBuildLog } from './utils';
import { ProblemDiagnosticResolver } from './ProblemDiagnosticResolver';
import { getBuildRootPath, getWorkspacePath } from './env';
import path from 'path';
import { CommandContext } from "./CommandManagement/CommandContext";

export function getFileNameLog() {
    const fileName = path.join(".logs", "build.log");
    return fileName;
}

export async function cleanDerivedData(context: CommandContext) {
    await context.execShellWithOptions({
        scriptOrCommand: { command: "rm" },
        args: ["-rf", getBuildRootPath()]
    });
}

export async function buildSelectedTarget(context: CommandContext, problemResolver: ProblemDiagnosticResolver) {
    await checkWorkspace(context);
    emptyBuildLog();
    const filePath = getFileNameLog();
    problemResolver.parseAsyncLogs(getWorkspacePath(), filePath);
    await context.execShell(
        "Build",
        { file: "build_app.sh" },
        ["-TARGET"],
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
        { file: "build_app.sh" },
        ["-TESTING"],
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
        { file: "build_app.sh" },
        ["-TESTING_ONLY_TESTS", option],
    );
}