import { checkWorkspace } from "./commands";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { getBuildRootPath } from "./env";
import path from "path";
import { CommandContext } from "./CommandManagement/CommandContext";
import { BuildManager } from "./Services/BuildManager";

export function getFileNameLog() {
    const fileName = path.join(".logs", "build.log");
    return fileName;
}

export async function cleanDerivedData(context: CommandContext) {
    await context.execShellWithOptions({
        scriptOrCommand: { command: "rm" },
        args: ["-rf", await getBuildRootPath()],
    });
}

export async function buildSelectedTarget(
    context: CommandContext,
    problemResolver: ProblemDiagnosticResolver
) {
    await checkWorkspace(context);
    const buildManager = new BuildManager();
    const filePath = getFileNameLog();
    const rawParser = problemResolver.parseAsyncLogs(filePath, context.buildEvent);
    try {
        await buildManager.build(context, filePath);
    } finally {
        problemResolver.end(rawParser);
    }
}

// TESTS

export async function buildTests(
    context: CommandContext,
    problemResolver: ProblemDiagnosticResolver
) {
    await checkWorkspace(context);
    const buildManager = new BuildManager();
    const filePath = getFileNameLog();
    const rawParser = problemResolver.parseAsyncLogs(filePath, context.buildEvent);
    try {
        await buildManager.buildForTestingWithTests(context, filePath, []);
    } finally {
        problemResolver.end(rawParser);
    }
}

export async function buildTestsForCurrentFile(
    context: CommandContext,
    problemResolver: ProblemDiagnosticResolver,
    tests: string[]
) {
    await checkWorkspace(context);
    const buildManager = new BuildManager();
    const filePath = getFileNameLog();
    const rawParser = problemResolver.parseAsyncLogs(filePath, context.buildEvent);
    try {
        await buildManager.buildForTestingWithTests(context, filePath, tests);
    } finally {
        problemResolver.end(rawParser);
    }
}
