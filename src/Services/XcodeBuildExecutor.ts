import * as vscode from "vscode";
import {
    getBuildRootPath,
    getFilePathInWorkspace,
    getScriptPath,
    getWorkspaceFolder,
    getXCodeBuildServerPath,
    isActivated,
} from "../env";
import * as fs from "fs/promises";
import * as path from "path";
import { CommandContext } from "../CommandManagement/CommandContext";
import { Executor, ExecutorMode, ExecutorTaskError, ShellProcessResult } from "../Executor";
import { XCRunHelper } from "../Tools/XCRunHelper";
import { sleep } from "../utils";

async function buildingMode() {
    if ((await isActivated()) === false) {
        return "xcodebuild";
    }
    const mode = vscode.workspace
        .getConfiguration("vscode-ios", getWorkspaceFolder())
        .get("building.system.mode", "xcodebuild");
    return mode;
}

export class XcodeBuildExecutor {
    constructor() {}

    async canStartBuildInXcode(context: CommandContext): Promise<boolean> {
        if (
            (await buildingMode()) !== "xcodebuild" &&
            (await this.isXcodeOpenWithWorkspaceOrProject(
                await context.projectEnv.projectFile,
                await context.projectEnv.projectType
            ))
        ) {
            return true;
        }
        return false;
    }

    async startBuildInXcode(context: CommandContext, logFilePath: string, scheme: string) {
        const derivedPath = await getBuildRootPath();
        const previousLogs =
            (await allLogsPath(`${derivedPath}/Logs/Build/LogStoreManifest.plist`, scheme)) || [];

        const buildComplete = watchXcactivitylog(
            context,
            previousLogs.map(log => log.path),
            derivedPath,
            scheme,
            logFilePath
        );
        this.watchXcodeProcesses(context);
        let xcodeBuild: ShellProcessResult | undefined = undefined;
        let xcodeBuildTapReplaceDialog: ShellProcessResult | undefined = undefined;
        try {
            xcodeBuild = context.execShellWithOptionsAndProc({
                scriptOrCommand: { command: "osascript" },
                args: [
                    "-l",
                    "JavaScript",
                    getScriptPath("xcode_build.js"),
                    projectWorkspace(
                        await context.projectEnv.projectFile,
                        await context.projectEnv.projectType
                    ),
                    scheme,
                ],
                mode: ExecutorMode.onlyCommandNameAndResult,
            });
            xcodeBuild.result.then(async () => {
                xcodeBuildTapReplaceDialog = context.execShellWithOptionsAndProc({
                    scriptOrCommand: { command: "osascript" },
                    args: [
                        "-l",
                        "JavaScript",
                        getScriptPath("xcode_build.js"),
                        projectWorkspace(
                            await context.projectEnv.projectFile,
                            await context.projectEnv.projectType
                        ),
                        "-tapReplaceDialog",
                    ],
                    mode: ExecutorMode.onlyCommandNameAndResult,
                });
            });
            await Promise.all([xcodeBuild.result, buildComplete]);
        } finally {
            const anyVar = xcodeBuildTapReplaceDialog as any; // to avoid ts error
            if (anyVar?.proc && anyVar?.proc.connected) {
                anyVar?.proc.kill("SIGKILL");
            }
        }
    }

    async watchXcodeProcesses(context: CommandContext) {
        while (!context.isCancelledOrDisposed) {
            if (
                (await this.isXcodeOpenWithWorkspaceOrProject(
                    await context.projectEnv.projectFile,
                    await context.projectEnv.projectType
                )) === false
            ) {
                context.cancel();
            }
            await sleep(3000);
        }
    }

    async isXcodeOpenWithWorkspaceOrProject(
        projectFile: string,
        projectType: string
    ): Promise<boolean> {
        // find all pids of Xcode processes using psaux
        // use lsof to check there's any project or workspace which is opened with Xcode processes pid
        try {
            const psOut = await new Executor().execShell({
                scriptOrCommand: { command: "ps aux | grep Xcode" },
            });
            const xcodePids = psOut.stdout
                .split("\n")
                .filter(line => line.includes("/Contents/MacOS/Xcode"))
                .map(line => line.trim().split(/\s+/).at(1) || "")
                .filter(pid => pid !== "");
            if (xcodePids.length === 0) {
                return false;
            }
            projectFile = projectWorkspace(projectFile, projectType);
            // const shasumOut = (
            //     await commandContext.execShellParallel({
            //         scriptOrCommand: {
            //             command: `bash -c 'echo -n "${projectFile}" | shasum -a 256'`,
            //         },
            //     })
            // ).stdout
            //     .trim()
            //     .split(" ")
            //     .at(0);
            const shasumOut = await getXcodeHash(projectFile);
            if (!shasumOut) {
                return false;
            }

            const lsofOut = await new Executor().execShell({
                scriptOrCommand: { command: `lsof -p ${xcodePids.join(",")}` },
            });

            const lsofLines = lsofOut.stdout.split("\n");
            for (const lsofLine of lsofLines) {
                if (lsofLine.includes(shasumOut)) {
                    return true;
                }
            }
            return false;
        } catch {
            return false;
        }
    }
}

async function watchXcactivitylog(
    context: CommandContext,
    previousLogs: string[],
    derivedPath: string,
    scheme: string | undefined,
    logFilePath: string
) {
    // watch DerivedData/Logs/xcactivitylog to update index
    const status = await fs.watch(`${derivedPath}/Logs/Build/LogStoreManifest.plist`, {
        recursive: false,
    });
    for await (const event of status) {
        if (event.eventType !== "rename") {
            continue;
        }
        if (context.cancellationToken.isCancellationRequested) {
            break;
        }
        if (event.filename && event.filename.endsWith("LogStoreManifest.plist")) {
            // append to log file to trigger index update
            const newestLog = await newestLogpath(
                `${derivedPath}/Logs/Build/LogStoreManifest.plist`,
                scheme
            );
            console.log(`Newest log path: ${newestLog}`);
            if (newestLog && newestLog.path && newestLog.path.length > 0) {
                // read logs
                if (previousLogs.indexOf(newestLog.path) !== -1) {
                    // the old log, skip
                    continue;
                }
                await context.execShellWithOptions({
                    scriptOrCommand: { command: getXCodeBuildServerPath() },
                    pipeToParseBuildErrors: true,
                    args: ["debug", "print-build-log", newestLog.path],
                    mode: ExecutorMode.onlyCommandNameAndResult,
                    pipe: {
                        scriptOrCommand: { command: "tee" },
                        args: [logFilePath],
                        mode: ExecutorMode.none,
                    },
                });
                if (newestLog.hasError) {
                    throw new ExecutorTaskError("Build failed with errors", 1, null, "", undefined);
                }
                return;
            } else {
                console.log(`No newest log path found for scheme: ${scheme}`);
            }
        }
    }
}

async function newestLogpath(
    metapath: string,
    scheme?: string
): Promise<{ path: string; hasError: boolean } | null> {
    const logs = await allLogsPath(metapath, scheme);
    if (logs === null || logs.length === 0) {
        return null;
    }
    return logs[0];
}

async function allLogsPath(
    metapath: string,
    scheme?: string
): Promise<{ path: string; hasError: boolean }[] | null> {
    // Read and parse the plist file
    let meta: any;
    try {
        const data = await XCRunHelper.convertPlistToJson(metapath);
        meta = JSON.parse(data);
    } catch (e) {
        return null;
    }

    let logs: any[] = Object.values(meta.logs || {});
    if (scheme) {
        logs = logs.filter(v => v["schemeIdentifier-schemeName"] === scheme);
    }
    if (!logs.length) {
        return null;
    }

    logs.sort((a, b) => b.timeStoppedRecording - a.timeStoppedRecording);
    return logs.map(log => ({
        path: path.join(path.dirname(metapath), log.fileName),
        hasError: log.primaryObservable.totalNumberOfErrors > 0,
    }));
}

function projectWorkspace(projectFile: string, projectType: string) {
    projectFile = getFilePathInWorkspace(projectFile);
    if (projectType === "-project") {
        projectFile += "/project.xcworkspace";
    }
    return projectFile;
}

async function getXcodeHash(path: string) {
    // Encode the string into bytes (UTF-8)
    const msgUint8 = new TextEncoder().encode(path);

    // Hash the message
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);

    // Convert buffer to byte array
    const hashArray = Array.from(new Uint8Array(hashBuffer));

    // Convert bytes to hex string
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    return hashHex;
}
