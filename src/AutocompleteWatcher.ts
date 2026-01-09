import * as vscode from "vscode";
import { getLogRelativePath, getWorkspaceFolder, isActivated } from "./env";
import { emptyAutobuildLog } from "./utils";
import { sleep } from "./utils";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { AtomicCommand, UserCommandIsExecuting } from "./CommandManagement/AtomicCommand";
import { BuildManager } from "./Services/BuildManager";
import { UserTerminatedError } from "./CommandManagement/CommandContext";
import * as fs from "fs";
import touch = require("touch");

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
            await this.atomicCommand.autoWatchCommand(
                async (context, includeTargets, excludeTargets) => {
                    if (
                        this.buildId !== buildId ||
                        (await this.isWatcherEnabledAnyFile()) === false
                    ) {
                        return;
                    }

                    emptyAutobuildLog();
                    const fileLog = getLogRelativePath("autocomplete.log");
                    const rawParser = this.problemResolver.parseAsyncLogs(
                        fileLog,
                        context.buildEvent
                    );
                    let shouldCleanPreviousBuildErrors = true; // by default, clean previous errors
                    try {
                        const buildManager = new BuildManager();
                        await buildManager.buildAutocomplete(
                            context,
                            fileLog,
                            includeTargets,
                            excludeTargets
                        );
                    } catch (error) {
                        // clean up build target scheme if it was created
                        try {
                            // delete unused scheme
                            const toDeleteSchemePath = context.projectEnv.buildScheme()?.path;
                            const touchProjectPath =
                                await context.projectEnv.buildScheme()?.projectPath;
                            if (toDeleteSchemePath && fs.existsSync(toDeleteSchemePath)) {
                                fs.unlinkSync(toDeleteSchemePath);
                            }
                            if (touchProjectPath && fs.existsSync(touchProjectPath)) {
                                touch.sync(touchProjectPath);
                            }
                        } catch {
                            // ignore errors
                        }

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
                }
            );
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
}

function removeAllWhiteSpaces(str: string) {
    return str.replace(/\s/g, "");
}
