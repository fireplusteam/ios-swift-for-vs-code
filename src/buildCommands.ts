import { checkWorkspace } from "./commands";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { getBuildRootPath, getLogRelativePath } from "./env";
import { CommandContext } from "./CommandManagement/CommandContext";
import { BuildManager, BuildTestsInput } from "./Services/BuildManager";
import { ExecutorMode } from "./Executor";
import { handleValidationErrors } from "./extension";
import { BuildServerLogParser } from "./LSP/LSPBuildServerLogParser";

export function getFileNameLog() {
    return getLogRelativePath("build.log");
}

export async function cleanDerivedData(context: CommandContext) {
    await checkWorkspace(context);

    const buildRootPath = await getBuildRootPath();
    // Safety check to avoid deleting arbitrary folders
    if (
        buildRootPath === undefined ||
        !buildRootPath.includes("/Library/Developer/Xcode/DerivedData/")
    ) {
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
    const buildServer = new BuildServerLogParser(context.log);
    buildServer.startParsing(context.cancellationToken, context.buildEvent);
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
    } catch (error) {
        buildServer.endParsing(error);
        throw error;
    } finally {
        await problemResolver.end(context.bundle, rawParser);
    }
}

// TESTS

export async function buildTestsForCurrentFile(
    context: CommandContext,
    problemResolver: ProblemDiagnosticResolver,
    input: BuildTestsInput
) {
    await checkWorkspace(context);
    const buildManager = new BuildManager();
    const filePath = getFileNameLog();
    const buildServer = new BuildServerLogParser(context.log);
    buildServer.startParsing(context.cancellationToken, context.buildEvent);
    const rawParser = problemResolver.parseAsyncLogs(filePath, context.buildEvent);
    try {
        const build = async () => {
            try {
                await buildManager.buildForTestingWithTests(context, filePath, input);
            } catch (error) {
                await handleValidationErrors(context, error, async () => {
                    await checkWorkspace(context);
                    await build();
                });
            }
        };
        await build();
    } catch (error) {
        buildServer.endParsing(error);
        throw error;
    } finally {
        await problemResolver.end(context.bundle, rawParser);
    }
}
