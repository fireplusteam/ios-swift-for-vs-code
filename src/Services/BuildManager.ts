import * as vscode from "vscode";
import touch = require("touch");
import { BundlePath } from "../CommandManagement/BundlePath";
import { CommandContext } from "../CommandManagement/CommandContext";
import { getWorkspaceFolder, ProjectEnv } from "../env";
import { ExecutorMode } from "../Executor";
import { XcodeBuildExecutor } from "./XcodeBuildExecutor";
import * as fs from "fs";
import { CustomError } from "../utils";
import { TestPlanIsNotConfigured } from "./ProjectSettingsProvider";

function isBuildIndexesWhileBuildingEnabled() {
    return vscode.workspace
        .getConfiguration("vscode-ios", getWorkspaceFolder())
        .get<boolean>("lsp.buildIndexesWhileBuilding", true);
}

export class BuildManager {
    private xcodeBuildExecutor: XcodeBuildExecutor = new XcodeBuildExecutor();

    constructor() {}

    static async commonArgs(projectEnv: ProjectEnv, bundle: BundlePath) {
        const deviceid = await projectEnv.debugDeviceID;
        let simulatorId = `id=${deviceid.id},platform=${deviceid.platform}`;
        if (deviceid.arch) {
            simulatorId += `,arch=${deviceid.arch}`;
        }
        const extra = [];
        if (isBuildIndexesWhileBuildingEnabled()) {
            extra.push("COMPILER_INDEX_STORE_ENABLE=YES"); // Control whether the compiler should emit index data while building.
        }
        return [
            "-configuration",
            await projectEnv.projectConfiguration,
            "-destination",
            simulatorId,
            "-resultBundlePath",
            bundle.bundlePath(),
            "-skipMacroValidation",
            "-skipPackageUpdates", // to speed up the build
            "-disableAutomaticPackageResolution",
            "-onlyUsePackageVersionsFromResolvedFile",
            // "-showBuildTimingSummary",
            ...extra,
            "COMPILATION_CACHE_ENABLE_CACHING=YES", // Caches the results of compilations for a particular set of inputs.
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
        if (await this.xcodeBuildExecutor.canStartBuildInXcode(context)) {
            // at the moment build-for-testing does not work with opened Xcode workspace/project
            await this.xcodeBuildExecutor.startBuildInXcode(
                context,
                logFilePath,
                await context.projectEnv.projectScheme
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

    async buildAutocomplete(
        context: CommandContext,
        logFilePath: string,
        includeTargets: string[] = [],
        excludeTargets: string[] = []
    ) {
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

        try {
            let allBuildScheme: string = await context.projectEnv.autoCompleteScheme;
            try {
                if ((await context.projectEnv.workspaceType()) === "xcodeProject") {
                    const scheme = await context.projectManager.addBuildAllTargetToProjects(
                        await context.projectEnv.projectScheme,
                        includeTargets,
                        excludeTargets
                    );
                    context.projectEnv.setBuildScheme(scheme);
                    if (scheme) {
                        allBuildScheme = scheme.scheme;
                    }
                }
            } catch (error) {
                // ignore errors
            }
            if (await this.xcodeBuildExecutor.canStartBuildInXcode(context)) {
                // at the moment build-for-testing does not work with opened Xcode workspace/project
                await this.xcodeBuildExecutor.startBuildInXcode(
                    context,
                    logFilePath,
                    allBuildScheme
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
                        allBuildScheme
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
        } finally {
            // clean up build target scheme if it was created
            try {
                // delete unused scheme
                const toDeleteSchemePath = context.projectEnv.buildScheme()?.path;
                const touchProjectPath = await context.projectEnv.buildScheme()?.projectPath;
                if (toDeleteSchemePath && fs.existsSync(toDeleteSchemePath)) {
                    fs.unlinkSync(toDeleteSchemePath);
                }
                if (touchProjectPath && fs.existsSync(touchProjectPath)) {
                    touch.sync(touchProjectPath);
                }
            } catch {
                // ignore errors
            }
        }
    }

    async buildForTestingWithTests(
        context: CommandContext,
        logFilePath: string,
        tests: string[],
        testPlan: string | undefined,
        isCoverage: boolean
    ) {
        context.bundle.generateNext();

        let allBuildScheme: string = await context.projectEnv.autoCompleteScheme;
        try {
            if (tests.length > 0 && testPlan === undefined) {
                const testsTargets = tests.map(test => test.split("/").at(0));
                const scheme = await context.projectManager.addTestSchemeDependOnTargetToProjects(
                    await context.projectEnv.projectScheme,
                    testsTargets.join(",")
                );
                context.projectEnv.setBuildScheme(scheme);
                if (scheme) {
                    allBuildScheme = scheme.scheme;
                }
            }
        } catch (error) {
            // ignore errors
        }

        // can not use Xcode to build-for-testing as the purpose of such build is to produce .xctestrun files, Xcode does not support that
        // if (await this.xcodeBuildExecutor.canStartBuildInXcode(context)) {
        //     // at the moment build-for-testing does not work with opened Xcode workspace/project
        //     await this.xcodeBuildExecutor.startBuildInXcode(
        //         context,
        //         logFilePath,
        //         allBuildScheme
        //     );
        //     return;
        // }

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
                ...(await BuildManager.args(context.projectEnv, context.bundle, allBuildScheme)),
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
