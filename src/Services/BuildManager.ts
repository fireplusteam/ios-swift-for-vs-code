import * as vscode from "vscode";
import touch = require("touch");
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
import { createInterface } from "readline";
import { ensureKilled, sleep } from "../utils";
// import { createInterface } from "readline";
// import { sleep } from "../utils";

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

class BuildTargetSpy {
    private end: boolean = false;
    private outfile: fs.ReadStream | undefined;
    private onReceiveMessage: (message: string) => void = () => {};
    private isMessageSent = new Set<string>();

    constructor(private env: { [name: string]: string }) {}

    async prepare() {
        const spyOutputFile = this.env["SWBBUILD_SERVICE_PROXY_SERVER_SPY_OUTPUT_FILE"];
        fs.writeFileSync(spyOutputFile, ""); // clear spy output file before build, so we can be sure that all messages are from current build session
    }

    private async readMessages() {
        const spyOutputFile = this.env["SWBBUILD_SERVICE_PROXY_SERVER_SPY_OUTPUT_FILE"];
        // should be optimized to not read the file from the beginning every time, but since spy messages are expected to be not so often and file is expected to be small, this approach should be fine for now and is much simpler than keeping track of file pointer and re-opening file with new pointer after each message
        const outputFile = fs.createReadStream(spyOutputFile, {
            flags: "r",
            encoding: "utf-8",
            highWaterMark: 1,
            autoClose: false,
            start: 0,
            end: Number.MAX_SAFE_INTEGER,
        });
        this.outfile = outputFile;
        const rl = createInterface({
            input: outputFile,
            crlfDelay: Infinity,
            terminal: false,
        });

        try {
            for await (const line of rl) {
                if (!this.end && !this.isMessageSent.has(line)) {
                    this.isMessageSent.add(line);
                    this.onReceiveMessage(line);
                }
            }
        } finally {
            outputFile.close();
        }
    }

    async spy(cancelToken: vscode.CancellationToken, onReceiveMessage: (message: string) => void) {
        this.onReceiveMessage = onReceiveMessage;
        let disposable: vscode.Disposable | undefined = undefined;
        try {
            disposable = cancelToken.onCancellationRequested(() => {
                this.end = true;
                this.outfile?.close();
            });
            do {
                this.readMessages();
                await sleep(1000);
            } while (!this.end);
        } catch (error) {
            if (!this.end) {
                onReceiveMessage(`Spy failed: ${error}`);
            }
            throw error;
        } finally {
            disposable?.dispose();
        }
    }

    async endSpy() {
        await this.readMessages(); // read remaining messages before ending spy
        this.end = true;
        this.outfile?.close();
    }
}

export class BuildManager {
    private xcodeBuildExecutor: XcodeBuildExecutor = new XcodeBuildExecutor();
    private buildingCommand: ShellProcessResult | undefined = undefined;
    private buildingCommandError: Error | undefined = undefined;

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

    private markTargetUpToDateAfterBuild(
        context: CommandContext,
        builtTargetIds: Set<string>,
        buildTouchTime: number,
        error: Error | undefined
    ) {
        // if error was generated, we don't want to mark all dependencies as up to date with error, because it will cause rebuild for success targets, instead we mark only built targets and leave dependencies to be rebuilt upon their individual status
        const allBuiltTargetsIds = error
            ? builtTargetIds
            : context.semanticManager.getAllTargetsDependencies(new Set(builtTargetIds));
        // mark all built targets and their dependencies as up to date if they were not modified during the build
        context.semanticManager.markTargetUpToDate(allBuiltTargetsIds, buildTouchTime, error);
    }

    private async startSpyService(
        context: CommandContext,
        buildEnv: { [name: string]: string },
        buildableTargetsIds: Set<string>,
        buildTouchTime: number,
        shouldStopAfterGotStatusForAllTargets: boolean
    ) {
        const buildTargetSpy = new BuildTargetSpy(buildEnv);
        await buildTargetSpy.prepare();
        let isEndSpyCalled = false;
        this.buildingCommandError = undefined;
        buildTargetSpy.spy(context.cancellationToken, message => {
            if (isEndSpyCalled) {
                return; // after end spy we don't want to process any messages
            }
            if (message.startsWith("Success:")) {
                const targetId = message.split("Success:").at(1)?.trim();
                this.markTargetUpToDateAfterBuild(
                    context,
                    new Set([targetId ?? ""]),
                    buildTouchTime,
                    undefined
                );
                buildableTargetsIds.delete(targetId ?? "");
            } else if (message.startsWith("Fail:")) {
                this.buildingCommandError = new Error(
                    `Build failed for target ${message.split("Fail:").at(1)?.trim()}`
                );
                const targetId = message.split("Fail:").at(1)?.trim();
                this.markTargetUpToDateAfterBuild(
                    context,
                    new Set([targetId ?? ""]),
                    buildTouchTime,
                    new Error(`Build failed for target ${targetId}`)
                );
                buildableTargetsIds.delete(targetId ?? "");
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

        const buildEnv = await BuildManager.commonEnv();
        const buildTargetSpy = await this.startSpyService(
            context,
            buildEnv,
            builtTargetIds,
            buildTouchTime,
            false
        );

        try {
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
        const buildTargetSpy = await this.startSpyService(
            context,
            buildEnv,
            builtTargetIds,
            buildTouchTime,
            true
        );
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
                    // "CODE_SIGN_IDENTITY=",
                    // "CODE_SIGNING_REQUIRED=NO",
                    // "CODE_SIGN_ENTITLEMENTS=",
                    // "CODE_SIGNING_ALLOWED=NO",
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
                this.buildingCommandError === undefined &&
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
        const buildTargetSpy = await this.startSpyService(
            context,
            buildEnv,
            builtTargetIds,
            buildTouchTime,
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
