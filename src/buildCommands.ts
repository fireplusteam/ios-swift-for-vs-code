import { checkWorkspace } from "./commands";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { getBuildRootPath } from "./env";
import path from "path";
import { CommandContext } from "./CommandManagement/CommandContext";
import { BuildManager } from "./Services/BuildManager";
import { ExecutorMode } from "./Executor";
import { handleValidationErrors } from "./extension";

export function getFileNameLog() {
    const fileName = path.join(".logs", "build.log");
    return fileName;
}

export async function cleanDerivedData(context: CommandContext) {
    await context.execShellWithOptions({
        scriptOrCommand: { command: "rm" },
        args: ["-rf", await getBuildRootPath()],
        mode: ExecutorMode.onlyCommandNameAndResult,
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
        const build = async () => {
            try {
                await buildManager.build(context, filePath);
            } catch (error) {
                await handleValidationErrors(context, error, async () => {
                    await checkWorkspace(context);
                    await build();
                });
            }
        };
        await build();
    } finally {
        problemResolver.end(rawParser);
    }
}

// TESTS

export async function buildTestsForCurrentFile(
    context: CommandContext,
    problemResolver: ProblemDiagnosticResolver,
    tests: string[],
    isCoverage: boolean
) {
    await checkWorkspace(context);
    const buildManager = new BuildManager();
    const filePath = getFileNameLog();
    const rawParser = problemResolver.parseAsyncLogs(filePath, context.buildEvent);
    try {
        const build = async () => {
            try {
                await buildManager.buildForTestingWithTests(context, filePath, tests, isCoverage);
            } catch (error) {
                await handleValidationErrors(context, error, async () => {
                    await checkWorkspace(context);
                    await build();
                });
            }
        };
        await build();
    } finally {
        problemResolver.end(rawParser);
    }
}
