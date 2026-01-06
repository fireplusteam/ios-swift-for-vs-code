import { BundlePath } from "../CommandManagement/BundlePath";
import { CommandContext } from "../CommandManagement/CommandContext";
import { ProjectEnv } from "../env";
import { ExecutorMode } from "../Executor";
import { CustomError } from "../utils";
import { TestPlanIsNotConfigured } from "./ProjectSettingsProvider";
import { XcodeBuildExecutor } from "./XcodeBuildExecutor";

export class BuildManager {
    private xcodeBuildExecutor: XcodeBuildExecutor = new XcodeBuildExecutor();

    constructor() {}

    static async commonArgs(projectEnv: ProjectEnv, bundle: BundlePath) {
        return [
            "-configuration",
            await projectEnv.projectConfiguration,
            "-destination",
            `id=${(await projectEnv.debugDeviceID).id},platform=${(await projectEnv.debugDeviceID).platform}`,
            "-resultBundlePath",
            bundle.bundlePath(),
            "-skipMacroValidation",
            "-skipPackageUpdates", // to speed up the build
            "-disableAutomaticPackageResolution",
            "-onlyUsePackageVersionsFromResolvedFile",
            "-showBuildTimingSummary",
        ];
    }

    static async args(
        projectEnv: ProjectEnv,
        bundle: BundlePath,
        scheme: string | undefined = undefined
    ) {
        return [
            ...(await BuildManager.commonArgs(projectEnv, bundle)),
            await projectEnv.projectType,
            await projectEnv.projectFile,
            "-scheme",
            scheme === undefined ? await projectEnv.projectScheme : scheme,
        ];
    }

    async checkFirstLaunchStatus(context: CommandContext) {
        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            args: [
                await context.projectEnv.projectType,
                await context.projectEnv.projectFile,
                "-checkFirstLaunchStatus",
            ],
            mode: ExecutorMode.verbose,
        });

        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            args: [
                "-resolvePackageDependencies",
                await context.projectEnv.projectType,
                await context.projectEnv.projectFile,
                "-scheme",
                await context.projectEnv.projectScheme,
            ],
            mode: ExecutorMode.resultOk | ExecutorMode.stderr | ExecutorMode.commandName,
            pipe: {
                scriptOrCommand: { command: "xcbeautify", labelInTerminal: "Build" },
                mode: ExecutorMode.stdout,
            },
        });
    }

    async build(context: CommandContext, logFilePath: string) {
        if (
            await this.xcodeBuildExecutor.isXcodeOpenWithWorkspaceOrProject(
                await context.projectEnv.projectFile,
                await context.projectEnv.projectType
            )
        ) {
            // at the moment build-for-testing does not work with opened Xcode workspace/project
            await this.xcodeBuildExecutor.startBuildInXcode(
                context,
                logFilePath,
                await context.projectEnv.projectScheme,
                "build"
            );
            return;
        }

        context.bundle.generateNext();
        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            pipeToParseBuildErrors: true,
            args: await BuildManager.args(context.projectEnv, context.bundle),
            mode: ExecutorMode.resultOk | ExecutorMode.stderr | ExecutorMode.commandName,
            pipe: {
                scriptOrCommand: { command: "tee" },
                args: [logFilePath],
                mode: ExecutorMode.none,
                pipe: {
                    scriptOrCommand: { command: "xcbeautify", labelInTerminal: "Build" },
                    mode: ExecutorMode.stdout,
                },
            },
        });
    }

    async buildAutocomplete(context: CommandContext, logFilePath: string) {
        let buildCommand: "build" | "build-for-testing" = "build-for-testing";
        try {
            await context.projectSettingsProvider.testPlans;
        } catch (error) {
            if (error instanceof CustomError && error.isEqual(TestPlanIsNotConfigured)) {
                buildCommand = "build";
            } else {
                throw error;
            }
        }

        if (
            await this.xcodeBuildExecutor.isXcodeOpenWithWorkspaceOrProject(
                await context.projectEnv.projectFile,
                await context.projectEnv.projectType
            )
        ) {
            // at the moment build-for-testing does not work with opened Xcode workspace/project
            await this.xcodeBuildExecutor.startBuildInXcode(
                context,
                logFilePath,
                await context.projectEnv.autoCompleteScheme,
                buildCommand
            );
            return;
        }
        context.bundle.generateNext();

        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            pipeToParseBuildErrors: true,
            args: [
                buildCommand,
                ...(await BuildManager.args(
                    context.projectEnv,
                    context.bundle,
                    await context.projectEnv.autoCompleteScheme
                )),
                "-skipUnavailableActions", // for autocomplete, skip if it fails
                "-jobs",
                "4",
            ],
            env: {
                continueBuildingAfterErrors: "True", // build even if there's an error triggered
            },
            mode: ExecutorMode.resultOk | ExecutorMode.stderr | ExecutorMode.commandName,
            pipe: {
                scriptOrCommand: { command: "tee" },
                args: [logFilePath],
                mode: ExecutorMode.none,
            },
        });
    }

    async buildForTestingWithTests(
        context: CommandContext,
        logFilePath: string,
        tests: string[],
        isCoverage: boolean
    ) {
        // TODO: build for testing is not supported when Xcode project/workspace is opened, so leave it as is for now
        context.bundle.generateNext();
        const extraArguments: string[] = [];
        if (isCoverage) {
            extraArguments.push(...["-enableCodeCoverage", "YES"]);
        }

        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            pipeToParseBuildErrors: true,
            args: [
                "build-for-testing",
                ...tests.map(test => {
                    return `-only-testing:${test}`;
                }),
                ...(await BuildManager.args(
                    context.projectEnv,
                    context.bundle,
                    await context.projectEnv.autoCompleteScheme
                )),
                ...extraArguments,
            ],
            mode: ExecutorMode.resultOk | ExecutorMode.stderr | ExecutorMode.commandName,
            pipe: {
                scriptOrCommand: { command: "tee" },
                args: [logFilePath],
                mode: ExecutorMode.none,
                pipe: {
                    scriptOrCommand: {
                        command: "xcbeautify",
                        labelInTerminal: "Build For Testing",
                    },
                    mode: ExecutorMode.stdout,
                },
            },
        });
    }
}
