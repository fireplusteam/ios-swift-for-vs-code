import * as vscode from "vscode";
import { BundlePath } from "../CommandManagement/BundlePath";
import {
    CommandContext,
    UserTerminalCloseError,
    UserTerminatedError,
} from "../CommandManagement/CommandContext";
import {
    getFilePathInWorkspace,
    getSWBBuildServiceConfigTempFile,
    getWorkspaceFolder,
    ProjectEnv,
} from "../env";
import { ExecutorMode, ExecutorTaskError, ShellProcessResult } from "../Executor";
import { XcodeBuildExecutor } from "./XcodeBuildExecutor";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { ensureKilled } from "../utils";
import { BuildTargetSpy } from "./BuildTargetSpy";

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
    private buildingCommand: ShellProcessResult | undefined = undefined;
    private builtTargetIdsWithError = new Set<string>();

    constructor() {}

    static sessionId = randomUUID();
    static buildID = 0;

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
        env["SWBBUILD_SERVICE_PROXY_BUILD_ID"] = (BuildManager.buildID++).toString();
        env["SWBBUILD_SERVICE_PROXY_SERVER_SPY_OUTPUT_FILE"] =
            `${getSWBBuildServiceConfigTempFile(this.sessionId)}.spy`;
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
        // all settings https://developer.apple.com/documentation/xcode/build-settings-reference
        if (isBuildIndexesWhileBuildingEnabled()) {
            extra.push("COMPILER_INDEX_STORE_ENABLE=YES"); // Control whether the compiler should emit index data while building.
        }
        if (isCompilationCacheEnabled()) {
            extra.push("COMPILATION_CACHE_ENABLE_CACHING=YES"); // Caches the results of compilations for a particular set of inputs.
            extra.push("SWIFT_ENABLE_EXPLICIT_MODULES=YES");
        }
        // precompiled header breaks C++ autocompletion after incremental builds, so disable them by default
        extra.push("GCC_PRECOMPILE_PREFIX_HEADER=NO");
        // TODO: check CLANG_ENABLE_MODULES
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

    async clean(context: CommandContext) {
        context.bundle.generateNext();
        const projectEnv = context.projectEnv;
        const projectType = await projectEnv.projectType;
        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            args: [
                "clean",
                projectType,
                await projectEnv.projectFile,
                ...(projectType === "-workspace"
                    ? ["-scheme", await projectEnv.projectScheme]
                    : []),
            ],
            env: { ...(await BuildManager.commonEnv()) },
            mode: ExecutorMode.resultOk | ExecutorMode.stderr | ExecutorMode.commandName,
            kill: { signal: "SIGINT", allSubProcesses: false },
            pipe: {
                scriptOrCommand: { command: "xcbeautify", labelInTerminal: "Clean" },
                mode: ExecutorMode.stdout,
            },
        });
    }

    private alreadyMarkedTargetIds = new Set<string>();

    private markTargetUpToDateAfterBuild(
        context: CommandContext,
        builtTargetIds: Set<string>,
        buildTouchTime: number,
        error: Error | undefined
    ) {
        // if error was generated, we don't want to mark all dependencies as up to date with error, because it will cause rebuild for success targets, instead we mark only built targets and leave dependencies to be rebuilt upon their individual status
        let allBuiltTargetsIds = new Set<string>();
        if (error) {
            for (const targetId of builtTargetIds) {
                this.builtTargetIdsWithError.add(targetId);
            }
            allBuiltTargetsIds = builtTargetIds;
        } else {
            // we don't want to mark any target with error as up to date, even it came later as success
            allBuiltTargetsIds = new Set(
                [
                    ...context.semanticManager.getAllTargetsDependencies(
                        builtTargetIds,
                        this.alreadyMarkedTargetIds
                    ),
                ].filter(targetId => {
                    this.alreadyMarkedTargetIds.add(targetId);
                    return !this.builtTargetIdsWithError.has(targetId);
                })
            );
        }

        // mark all built targets and their dependencies as up to date if they were not modified during the build
        context.semanticManager.markTargetUpToDate(allBuiltTargetsIds, buildTouchTime, error);
    }

    private async startTargetBuildingSpyService(
        context: CommandContext,
        buildEnv: { [name: string]: string },
        buildableTargetsIds: Set<string>,
        buildTouchTime: number,
        shouldStopAfterGotStatusForAllTargets: boolean,
        canStartBuildInXcode: boolean
    ) {
        const buildTargetSpy = new BuildTargetSpy(buildEnv, canStartBuildInXcode);
        await buildTargetSpy.prepare();
        let isEndSpyCalled = false;
        this.builtTargetIdsWithError.clear();
        this.alreadyMarkedTargetIds.clear();
        buildTargetSpy.spy(context.buildEvent, context.cancellationToken, message => {
            if (isEndSpyCalled) {
                return; // after end spy we don't want to process any messages
            }
            if (message.startsWith("DEPENDENCY:")) {
                const [from, to] = message.split("DEPENDENCY:").at(1)?.trim().split("|^|^|") ?? [];
                context.log.debug("Got dependency from spy: " + from + " -> " + to);

                if (from !== to) {
                    context.semanticManager.setImplicitDependencies(from, [to]);
                }
            } else if (message.startsWith("Success:")) {
                const targetId = message.split("Success:").at(1)?.trim();
                this.markTargetUpToDateAfterBuild(
                    context,
                    new Set([targetId ?? ""]),
                    buildTouchTime,
                    undefined
                );
                context.log.debug(`Got success message for target ${targetId} from spy`);
                buildableTargetsIds.delete(targetId ?? "");
            } else if (message.startsWith("Success_building_log_id:")) {
                const buildLogTargetId = message.split("Success_building_log_id:").at(1)?.trim();
                if (buildLogTargetId) {
                    const targetId =
                        context.semanticManager.mapBuildLogsTargetIdToTargetId(buildLogTargetId);
                    if (targetId) {
                        this.markTargetUpToDateAfterBuild(
                            context,
                            new Set([targetId ?? ""]),
                            buildTouchTime,
                            undefined
                        );
                        buildableTargetsIds.delete(targetId ?? "");
                        context.log.debug(`Got success message for target ${targetId} from spy`);
                    }
                }
            } else if (message.startsWith("Fail:")) {
                const targetId = message.split("Fail:").at(1)?.trim();
                this.builtTargetIdsWithError.add(targetId ?? "");
                this.markTargetUpToDateAfterBuild(
                    context,
                    new Set([targetId ?? ""]),
                    buildTouchTime,
                    new Error(`Build failed for target ${targetId}`)
                );
                buildableTargetsIds.delete(targetId ?? "");
                context.log.debug(`Got fail message for target ${targetId} from spy`);
            }
            if (
                buildableTargetsIds.size === 0 &&
                shouldStopAfterGotStatusForAllTargets &&
                !isEndSpyCalled
            ) {
                isEndSpyCalled = true;
                // we got status for all interesting targets, interupt build here
                if (this.buildingCommand) {
                    this.buildingCommand.proc.kill("SIGINT");
                    ensureKilled(this.buildingCommand.proc);
                }
                buildTargetSpy.endSpy();
            }
        });
        return buildTargetSpy;
    }

    async build(context: CommandContext, logFilePath: string) {
        const buildTouchTime = Date.now();

        let builtTargetIds = new Set<string>();
        try {
            builtTargetIds = new Set(
                await context.projectManager.getTargetsForScheme(
                    await context.projectEnv.projectScheme
                )
            );
        } catch (error) {
            console.log(
                `Failed to get targets for scheme with error: ${error}, fallback to build without scheme targets info`
            );
        }

        const canStartBuildInXcode = await this.xcodeBuildExecutor.canStartBuildInXcode(context);
        const buildEnv = await BuildManager.commonEnv();
        const buildTargetSpy = await this.startTargetBuildingSpyService(
            context,
            buildEnv,
            builtTargetIds,
            buildTouchTime,
            false,
            canStartBuildInXcode
        );

        try {
            if (canStartBuildInXcode) {
                // at the moment build-for-testing does not work with opened Xcode workspace/project
                await this.xcodeBuildExecutor.startBuildInXcode(
                    context,
                    logFilePath,
                    await context.projectEnv.projectScheme
                );
                await buildTargetSpy.endSpy();
                this.markTargetUpToDateAfterBuild(
                    context,
                    builtTargetIds,
                    buildTouchTime,
                    undefined
                );
                return;
            }

            context.bundle.generateNext();
            this.buildingCommand = context.execShellWithOptionsAndProc({
                scriptOrCommand: { command: "xcodebuild" },
                pipeToParseBuildErrors: true,
                args: await BuildManager.args(context.projectEnv, context.bundle),
                env: { ...buildEnv },
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
            await this.buildingCommand.result;
            await buildTargetSpy.endSpy();
            this.markTargetUpToDateAfterBuild(context, builtTargetIds, buildTouchTime, undefined);
        } catch (error) {
            await buildTargetSpy.endSpy();
            if (error !== UserTerminatedError && error !== UserTerminalCloseError) {
                this.markTargetUpToDateAfterBuild(
                    context,
                    builtTargetIds,
                    buildTouchTime,
                    error instanceof Error ? error : new Error(String(error))
                );
            }
            throw error;
        }
    }

    async buildAutocomplete(
        context: CommandContext,
        logFilePath: string,
        includeTargets: string[] = []
    ) {
        const buildTouchTime = Date.now();
        const buildEnv = await BuildManager.commonEnv();
        const builtTargetIds = new Set<string>(includeTargets);
        const canStartBuildInXcode = await this.xcodeBuildExecutor.canStartBuildInXcode(context);

        const buildTargetSpy = await this.startTargetBuildingSpyService(
            context,
            buildEnv,
            builtTargetIds,
            buildTouchTime,
            true,
            canStartBuildInXcode
        );
        try {
            let allBuildScheme: string = await context.projectEnv.autoCompleteScheme;

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
                await buildTargetSpy.endSpy();
                this.markTargetUpToDateAfterBuild(
                    context,
                    builtTargetIds,
                    buildTouchTime,
                    undefined
                );
                return;
            }
            context.bundle.generateNext();

            this.buildingCommand = context.execShellWithOptionsAndProc({
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
                ],
                env: {
                    ...buildEnv,
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
            await this.buildingCommand.result;
            await buildTargetSpy.endSpy();
            this.markTargetUpToDateAfterBuild(context, builtTargetIds, buildTouchTime, undefined);
        } catch (error) {
            await buildTargetSpy.endSpy();

            if (error !== UserTerminatedError && error !== UserTerminalCloseError) {
                this.markTargetUpToDateAfterBuild(
                    context,
                    builtTargetIds,
                    buildTouchTime,
                    error instanceof Error ? error : new Error(String(error))
                );
            }
            if (
                this.builtTargetIdsWithError.size === 0 &&
                error instanceof ExecutorTaskError &&
                error.code === 75
            ) {
                // indexes for all targets are up to date, we should not trigger error as build is successful for autocomplete purposes, but we don't want to process with other targets as they are not needed now
            } else {
                throw error;
            }
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
                    context.projectManager.projectWatcher.touchWithoutNotify(touchProjectPath);
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

        const buildTouchTime = Date.now();
        const builtTargetIds = new Set<string>(
            input.tests
                .map(test => {
                    const targetName = test.split("/").at(0);
                    if (targetName) {
                        const targetId = `${getFilePathInWorkspace(input.projectFile)}::${targetName}`;
                        return targetId;
                    }
                    return "";
                })
                .filter(id => id.length > 0)
        );
        const buildEnv = await BuildManager.commonEnv();
        const buildTargetSpy = await this.startTargetBuildingSpyService(
            context,
            buildEnv,
            builtTargetIds,
            buildTouchTime,
            false,
            false
        );
        try {
            let allBuildScheme: string = await context.projectEnv.autoCompleteScheme;
            try {
                if (input.tests.length > 0 && input.testPlan === undefined) {
                    const testsTargets = input.tests.map(test => test.split("/").at(0));
                    const scheme =
                        await context.projectManager.addTestSchemeDependOnTargetToProjects(
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

            this.buildingCommand = context.execShellWithOptionsAndProc({
                scriptOrCommand: { command: "xcodebuild" },
                pipeToParseBuildErrors: true,
                args: [
                    "build-for-testing",
                    ...input.tests.map(test => {
                        return `-only-testing:${test}`;
                    }),
                    ...(await BuildManager.args(
                        context.projectEnv,
                        context.bundle,
                        allBuildScheme
                    )),
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
            await this.buildingCommand.result;
            await buildTargetSpy.endSpy();
            this.markTargetUpToDateAfterBuild(context, builtTargetIds, buildTouchTime, undefined);
        } catch (error) {
            await buildTargetSpy.endSpy();
            if (error !== UserTerminatedError && error !== UserTerminalCloseError) {
                this.markTargetUpToDateAfterBuild(
                    context,
                    builtTargetIds,
                    buildTouchTime,
                    error instanceof Error ? error : new Error(String(error))
                );
            }
            throw error;
        }
    }
}
