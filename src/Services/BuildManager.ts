import * as vscode from "vscode";
import touch = require("touch");
import { BundlePath } from "../CommandManagement/BundlePath";
import { CommandContext } from "../CommandManagement/CommandContext";
import { getSWBBuildServiceConfigTempFile, getWorkspaceFolder, ProjectEnv } from "../env";
import { ExecutorMode } from "../Executor";
import { XcodeBuildExecutor } from "./XcodeBuildExecutor";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

function isBuildIndexesWhileBuildingEnabled() {
    return vscode.workspace
        .getConfiguration("vscode-ios", getWorkspaceFolder())
        .get<boolean>("lsp.buildIndexesWhileBuilding", true);
}

function isCompilationCacheEnabled() {
    return vscode.workspace
        .getConfiguration("vscode-ios", getWorkspaceFolder())
        .get<boolean>("build.compilationCache", true);
}

function jobsCountForWatcher(): number {
    const jobs = vscode.workspace
        .getConfiguration("vscode-ios", getWorkspaceFolder())
        .get<number>("watcher.jobs", 2);
    return Math.min(Math.max(jobs, 1), 16);
}

export interface BuildTestsInput {
    projectFile: string;
    tests: string[];
    testPlan: string | undefined;
    isCoverage: boolean;
}

export class BuildManager {
    private xcodeBuildExecutor: XcodeBuildExecutor = new XcodeBuildExecutor();

    constructor() {}

    static sessionId = randomUUID();

    static async commonEnv() {
        const pid = process.pid;
        const env = {} as { [name: string]: string };
        env["SWBBUILD_SERVICE_PROXY_PATH"] = path.join(
            __dirname,
            "..",
            "src",
            "XCBBuildServiceProxy",
            "SWBBuildService.py"
        );
        env["SWBBUILD_SERVICE_PROXY_HOST_APP_PROCESS_ID"] = pid.toString();
        env["SWBBUILD_SERVICE_PROXY_SESSION_ID"] = BuildManager.sessionId.toString();
        env["SWBBUILD_SERVICE_PROXY_CONFIG_PATH"] = getSWBBuildServiceConfigTempFile(
            this.sessionId
        );
        return env;
    }

    static async stop() {
        const env = await BuildManager.commonEnv();
        const configPath = env["SWBBUILD_SERVICE_PROXY_CONFIG_PATH"] as string;
        if (configPath !== undefined && fs.existsSync(configPath)) {
            fs.writeFile(configPath, JSON.stringify({ command: "stop" }), () => {
                // ignore errors
            });
        }
    }

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
        if (isCompilationCacheEnabled()) {
            extra.push("COMPILATION_CACHE_ENABLE_CACHING=YES"); // Caches the results of compilations for a particular set of inputs.
        }
        // precompiled header breaks C++ autocompletion after incremental builds, so disable them by default
        extra.push("GCC_PRECOMPILE_PREFIX_HEADER=NO");
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
            "-showBuildTimingSummary",
            ...extra,
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
            env: { ...(await BuildManager.commonEnv()) },
            mode: ExecutorMode.verbose,
            kill: { signal: "SIGINT", allSubProcesses: false },
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
            env: { ...(await BuildManager.commonEnv()) },
            mode: ExecutorMode.resultOk | ExecutorMode.stderr | ExecutorMode.commandName,
            kill: { signal: "SIGINT", allSubProcesses: false },
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
            env: { ...(await BuildManager.commonEnv()) },
            mode: ExecutorMode.resultOk | ExecutorMode.stderr | ExecutorMode.commandName,
            kill: { signal: "SIGINT", allSubProcesses: false },
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
        includeTargets: string[] = []
    ) {
        try {
            let allBuildScheme: string = await context.projectEnv.autoCompleteScheme;
            const canStartBuildInXcode =
                await this.xcodeBuildExecutor.canStartBuildInXcode(context);
            try {
                if ((await context.projectEnv.workspaceType()) === "xcodeProject") {
                    const scheme =
                        await context.projectManager.addBuildAllDependentTargetsOfProjects(
                            await context.projectEnv.projectScheme,
                            includeTargets,
                            canStartBuildInXcode // touch project only if we are going to build in Xcode
                        );
                    context.projectEnv.setBuildScheme(scheme);
                    if (scheme) {
                        allBuildScheme = scheme.scheme;
                    }
                }
            } catch (error) {
                // ignore errors
            }
            if (canStartBuildInXcode) {
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
                    "build",
                    ...(await BuildManager.args(
                        context.projectEnv,
                        context.bundle,
                        allBuildScheme
                    )),
                    "-skipUnavailableActions", // for autocomplete, skip if it fails
                    "-jobs",
                    jobsCountForWatcher().toString(),
                    // "CODE_SIGN_IDENTITY=",
                    // "CODE_SIGNING_REQUIRED=NO",
                    // "CODE_SIGN_ENTITLEMENTS=",
                    // "CODE_SIGNING_ALLOWED=NO",
                ],
                env: {
                    ...(await BuildManager.commonEnv()),
                    continueBuildingAfterErrors: "True", // build even if there's an error triggered
                },
                mode: ExecutorMode.resultOk | ExecutorMode.stderr | ExecutorMode.commandName,
                kill: { signal: "SIGINT", allSubProcesses: false },
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
        input: BuildTestsInput
    ) {
        context.bundle.generateNext();

        let allBuildScheme: string = await context.projectEnv.autoCompleteScheme;
        try {
            if (input.tests.length > 0 && input.testPlan === undefined) {
                const testsTargets = input.tests.map(test => test.split("/").at(0));
                const scheme = await context.projectManager.addTestSchemeDependOnTargetToProjects(
                    input.projectFile,
                    await context.projectEnv.projectScheme,
                    testsTargets.join(","),
                    false
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
        if (input.isCoverage) {
            extraArguments.push(...["-enableCodeCoverage", "YES"]);
        }

        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            pipeToParseBuildErrors: true,
            args: [
                "build-for-testing",
                ...input.tests.map(test => {
                    return `-only-testing:${test}`;
                }),
                ...(await BuildManager.args(context.projectEnv, context.bundle, allBuildScheme)),
                ...extraArguments,
            ],
            env: { ...(await BuildManager.commonEnv()) },
            mode: ExecutorMode.resultOk | ExecutorMode.stderr | ExecutorMode.commandName,
            kill: { signal: "SIGINT", allSubProcesses: false },
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
