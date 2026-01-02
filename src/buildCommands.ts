import { checkWorkspace } from "./commands";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { getBuildRootPath, getLogRelativePath } from "./env";
import { CommandContext } from "./CommandManagement/CommandContext";
import { BuildManager } from "./Services/BuildManager";
import { ExecutorMode } from "./Executor";
import { handleValidationErrors } from "./extension";

export function getFileNameLog() {
    return getLogRelativePath("build.log");
}

export async function cleanDerivedData(context: CommandContext) {
    await checkWorkspace(context);

    const buildRootPath = await getBuildRootPath();
    // Safety check to avoid deleting arbitrary folders
    if (!buildRootPath.includes("/Library/Developer/Xcode/DerivedData/")) {
        throw new Error("Can only clean DerivedData folder");
    }

    await context.execShellWithOptions({
        scriptOrCommand: { command: "rm" },
        args: ["-rf", buildRootPath],
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
        await problemResolver.end(context.bundle, rawParser);
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
        await problemResolver.end(context.bundle, rawParser);
    }
}
