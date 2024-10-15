import { CommandContext } from "../CommandManagement/CommandContext";
import { getFilePathInWorkspace, ProjectEnv } from "../env";
import { ExecutorMode } from "../Executor";
import { deleteFile } from "../utils";

export class BuildManager {
    static BundlePath = ".vscode/.bundle";
    constructor() {}

    static async args(projectEnv: ProjectEnv) {
        return [
            "-configuration",
            await projectEnv.projectConfiguration,
            "-destination",
            `id=${(await projectEnv.debugDeviceID).id},platform=${(await projectEnv.debugDeviceID).platform}`,
            "-resultBundlePath",
            ".vscode/.bundle",
            "-skipMacroValidation",
            "-showBuildTimingSummary",
            await projectEnv.projectType,
            await projectEnv.projectFile,
            "-scheme",
            await projectEnv.projectScheme,
        ];
    }

    async build(context: CommandContext, logFilePath: string) {
        deleteFile(getFilePathInWorkspace(BuildManager.BundlePath));

        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            pipeToParseBuildErrors: true,
            args: await BuildManager.args(context.projectSettingsProvider.projectEnv),
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

        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            pipeToParseBuildErrors: true,
            args: [
                "build-for-testing",
                ...(await BuildManager.args(context.projectSettingsProvider.projectEnv)),
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
                ...(await BuildManager.args(context.projectSettingsProvider.projectEnv)),
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
