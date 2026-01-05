import * as vscode from "vscode";
import { getFilePathInWorkspace, getLogRelativePath, getWorkspaceFolder, isActivated } from "./env";
import { emptyAutobuildLog } from "./utils";
import { sleep } from "./utils";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { AtomicCommand, UserCommandIsExecuting } from "./CommandManagement/AtomicCommand";
import { BuildManager } from "./Services/BuildManager";
import { CommandContext, UserTerminatedError } from "./CommandManagement/CommandContext";
import { Executor } from "./Executor";

// Workaround to use build to update index, sourcekit doesn't support updating indexes in background
export class AutocompleteWatcher {
    static AutocompleteCommandName = "Watch";

    private disposable: vscode.Disposable[] = [];
    private atomicCommand: AtomicCommand;
    private problemResolver: ProblemDiagnosticResolver;

    private terminatingExtension: boolean = false;
    private changedFiles = new Map<string, string>();

    private buildId = 0;

    constructor(atomicCommand: AtomicCommand, problemResolver: ProblemDiagnosticResolver) {
        this.atomicCommand = atomicCommand;
        this.disposable.push(
            vscode.workspace.onDidOpenTextDocument(doc => {
                if (!doc || !this.isWatcherEnabledAnyFile()) {
                    return;
                }
                if (this.isValidFile(doc.uri.fsPath) === false) {
                    return;
                }
                this.changedFiles.set(doc.uri.fsPath, removeAllWhiteSpaces(doc.getText()));
            })
        );
        this.disposable.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                if (!doc || !this.isWatcherEnabledAnyFile()) {
                    return;
                }
                if (this.isValidFile(doc.uri.fsPath) === false) {
                    return;
                }

                const val = this.changedFiles.get(doc.uri.fsPath);
                const textOfDoc = removeAllWhiteSpaces(doc.getText());
                if (val === textOfDoc) {
                    return;
                }
                this.changedFiles.set(doc.uri.fsPath, textOfDoc);
                this.triggerIncrementalBuild().catch(() => {});
            })
        );
        this.problemResolver = problemResolver;
    }

    async triggerIncrementalBuild() {
        if ((await this.isWatcherEnabledAnyFile()) === false) {
            return;
        }
        this.buildId++;
        await this.incrementalBuild(this.buildId);
    }

    terminate() {
        this.terminatingExtension = true;
    }

    private async isWatcherEnabledAnyFile() {
        if ((await isActivated()) === false) {
            return false;
        }
        const isWatcherEnabled = vscode.workspace
            .getConfiguration("vscode-ios", getWorkspaceFolder())
            .get("watcher.singleModule");
        if (!isWatcherEnabled || this.terminatingExtension) {
            return false;
        }
        return true;
    }

    private isValidFile(filePath: string | undefined) {
        // Exclude Package.swift from triggering autocomplete watcher builds, as it requires to regenerate workspace which is heavy operation
        if (filePath && filePath.endsWith("Package.swift")) {
            return false;
        }
        if (
            filePath &&
            (filePath.endsWith(".swift") ||
                filePath.endsWith(".m") ||
                filePath.endsWith(".mm") ||
                filePath.endsWith(".cpp") ||
                filePath.endsWith(".c") ||
                filePath.endsWith(".h") ||
                filePath.endsWith(".hpp"))
        ) {
            return true;
        }
        return false;
    }

    private async incrementalBuild(buildId: number): Promise<any> {
        try {
            await this.atomicCommand.autoWatchCommand(async context => {
                if (this.buildId !== buildId || (await this.isWatcherEnabledAnyFile()) === false) {
                    return;
                }

                if (
                    await this.isXcodeOpenWithWorkspaceOrProject(
                        await context.projectEnv.projectFile,
                        await context.projectEnv.projectType
                    )
                ) {
                    // skip build when Xcode is open with workspace or project to avoid conflicts
                    // this.watchXcodeProcesses(
                    //     context,
                    //     await context.projectEnv.projectFile,
                    //     await context.projectEnv.projectType,
                    //     buildId,
                    //     true
                    // );
                    return;
                } else {
                    // this.watchXcodeProcesses(
                    //     context,
                    //     await context.projectEnv.projectFile,
                    //     await context.projectEnv.projectType,
                    //     buildId,
                    //     false
                    // );
                }

                emptyAutobuildLog();
                const fileLog = getLogRelativePath("autocomplete.log");
                const rawParser = this.problemResolver.parseAsyncLogs(fileLog, context.buildEvent);
                let shouldCleanPreviousBuildErrors = true; // by default, clean previous errors
                try {
                    const buildManager = new BuildManager();
                    await buildManager.buildAutocomplete(context, fileLog);
                } catch (error) {
                    if (error === UserTerminatedError) {
                        shouldCleanPreviousBuildErrors = false; // do not clean previous errors if user terminated (like when a user edits a file again)
                    }
                    throw error;
                } finally {
                    await this.problemResolver.end(
                        context.bundle,
                        rawParser,
                        false,
                        shouldCleanPreviousBuildErrors
                    );
                }
            });
        } catch (err) {
            if (err === UserCommandIsExecuting) {
                await sleep(1000);
                if (buildId === this.buildId) {
                    // still valid
                    this.incrementalBuild(buildId).catch(() => {});
                } // do nothing
            } else {
                throw err;
            }
        }
    }

    async watchXcodeProcesses(
        commandContext: CommandContext,
        projectFile: string,
        projectType: string,
        buildId: number,
        cancelledDueToXcodeOpen: boolean
    ) {
        while (this.buildId === buildId) {
            if (commandContext.cancellationToken.isCancellationRequested) {
                if (!cancelledDueToXcodeOpen) {
                    break;
                }
            }
            if ((await this.isXcodeOpenWithWorkspaceOrProject(projectFile, projectType)) === true) {
                if (!commandContext.cancellationToken.isCancellationRequested) {
                    cancelledDueToXcodeOpen = true;
                    commandContext.cancel();
                }
            } else {
                if (cancelledDueToXcodeOpen) {
                    this.triggerIncrementalBuild();
                    break;
                }
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
            projectFile = getFilePathInWorkspace(projectFile);
            if (projectType === "-project") {
                projectFile += "/project.xcworkspace";
            }
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

function removeAllWhiteSpaces(str: string) {
    return str.replace(/\s/g, "");
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
