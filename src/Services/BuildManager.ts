import { CommandContext } from "../CommandManagement/CommandContext";
import { getFilePathInWorkspace, ProjectEnv } from "../env";
import { ExecutorMode } from "../Executor";
import { deleteFile } from "../utils";

export class BuildManager {
    static BundlePath = ".vscode/xcode/.bundle";
    static get BundleResultPath(): string {
        return `${BuildManager.BundlePath}.xcresult`;
    }
    constructor() {}

    static async args(projectEnv: ProjectEnv) {
        return [
            "-configuration",
            await projectEnv.projectConfiguration,
            "-destination",
            `id=${(await projectEnv.debugDeviceID).id},platform=${(await projectEnv.debugDeviceID).platform}`,
            "-resultBundlePath",
            BuildManager.BundlePath,
            "-skipMacroValidation",
            "-skipPackageUpdates", // to speed up the build
            "-disableAutomaticPackageResolution",
            "-onlyUsePackageVersionsFromResolvedFile",
            "-showBuildTimingSummary",
            await projectEnv.projectType,
            await projectEnv.projectFile,
            "-scheme",
            await projectEnv.projectScheme,
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
        deleteFile(getFilePathInWorkspace(BuildManager.BundlePath));

        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            pipeToParseBuildErrors: true,
            args: await BuildManager.args(context.projectEnv),
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
        deleteFile(getFilePathInWorkspace(BuildManager.BundlePath));

        let buildCommand = "build";
        if ((await context.projectSettingsProvider.testPlans).length > 0) {
            buildCommand = "build-for-testing";
        }

        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            pipeToParseBuildErrors: true,
            args: [
                buildCommand,
                ...(await BuildManager.args(context.projectEnv)),
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

    async buildForTestingWithTests(context: CommandContext, logFilePath: string, tests: string[]) {
        deleteFile(getFilePathInWorkspace(BuildManager.BundlePath));

        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            pipeToParseBuildErrors: true,
            args: [
                "build-for-testing",
                ...tests.map(test => {
                    return `-only-testing:${test}`;
                }),
                ...(await BuildManager.args(context.projectEnv)),
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
