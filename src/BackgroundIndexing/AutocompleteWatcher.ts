import * as vscode from "vscode";
import { getLogRelativePath, getWorkspaceFolder, isActivated } from "../env";
import { emptyAutobuildLog } from "../utils";
import { sleep } from "../utils";
import { ProblemDiagnosticResolver } from "../ProblemDiagnosticResolver";
import { AtomicCommand, UserCommandIsExecuting } from "../CommandManagement/AtomicCommand";
import { BuildManager } from "../Services/BuildManager";
import { CommandContext, UserTerminatedError } from "../CommandManagement/CommandContext";
import { BuildServerLogParser } from "../LSP/LSPBuildServerLogParser";
import { LogChannelInterface } from "../Logs/LogChannel";
import * as path from "path";
import { SemanticManagerInterface, TargetIndexStatus } from "./SemanticManager";

// Workaround to use build to update index, sourcekit doesn't support updating indexes in background
export class AutocompleteWatcher {
    static AutocompleteCommandName = "Watch";

    private disposable: vscode.Disposable[] = [];
    private atomicCommand: AtomicCommand;
    private problemResolver: ProblemDiagnosticResolver;

    private terminatingExtension: boolean = false;
    private changedFiles = new Map<string, string>();

    private buildId = 0;
    private buildTouchTime = 0;

    private activelyBuildingTargetsIds = new Set<string>();

    constructor(
        atomicCommand: AtomicCommand,
        problemResolver: ProblemDiagnosticResolver,
        readonly semanticManager: SemanticManagerInterface,
        private log: LogChannelInterface
    ) {
        this.atomicCommand = atomicCommand;
        this.disposable.push(
            vscode.window.onDidChangeActiveTextEditor(doc => {
                if (!doc || !this.isWatcherEnabledAnyFile()) {
                    return;
                }
                if (this.isValidFile(doc.document.uri.fsPath) === false) {
                    return;
                }
                this.changedFiles.set(
                    doc.document.uri.fsPath,
                    removeAllWhiteSpaces(doc.document.getText())
                );

                this.triggerIncrementalBuild(doc.document.uri, false);
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
                // file content changed, mark dependent targets out of date
                this.changedFiles.set(doc.uri.fsPath, textOfDoc);
                const fileTargets = new Map(
                    this.semanticManager
                        .statusOfTargetsForFile(doc.uri.fsPath)
                        .map(target => [target.id || "", target.targetStatus])
                );

                // mark all dependent targets out of date but not for the targets of that file, as onces we have sucessful build and compile flags are enough to retrigger indexes
                const dependentTargets = Array.from(
                    this.semanticManager.getAllDependentTargets(new Set(fileTargets.keys()))
                ).filter(id => {
                    if (id.length === 0) {
                        return false;
                    }
                    // we don't want to rebuild up to date targets, as we have all required compile flags and indexes until a new file is added or deleted for the target or there's a change in one of the dependencies of that target
                    if (fileTargets.has(id) && fileTargets.get(id) === TargetIndexStatus.UpToDate) {
                        return false;
                    }
                    return true;
                });
                this.semanticManager.markTargetOutOfDate(new Set(dependentTargets));
                // trigger build for the file to update index
                this.triggerIncrementalBuild(doc.uri, true);
            })
        );
        this.problemResolver = problemResolver;
    }

    async triggerIncrementalBuild(
        file: vscode.Uri | undefined,
        wasFileModified: boolean,
        context:
            | { commandContext: CommandContext; includeTargets: string[]; excludeTargets: string[] }
            | undefined = undefined
    ) {
        if ((await this.isWatcherEnabledAnyFile()) === false) {
            return;
        }
        if (file === undefined || this.isValidFile(file.fsPath) === false) {
            return;
        }
        const statusEntry = this.semanticManager
            .statusOfTargetsForFile(file.fsPath)
            .filter(entry => {
                if (wasFileModified) {
                    return entry.targetStatus !== TargetIndexStatus.UpToDate;
                }
                // if content of file was not changed, no need to rebuild if the target is already up to date with errors, as the result would be the same.
                return (
                    entry.targetStatus !== TargetIndexStatus.UpToDate &&
                    entry.targetStatus !== TargetIndexStatus.UpToDateWithError
                );
            });
        const dependencies = this.semanticManager.getAllTargetsDependencies(
            this.activelyBuildingTargetsIds
        );
        const leftTargets = statusEntry.filter(target => {
            if (target.id === undefined) {
                return false; // not part of any target, skip
            }
            if (dependencies.has(target.id)) {
                return target.lastTouchTime > this.buildTouchTime; // already being built but modified later, need to build again
            }
            return true; // this target is not being built currently, need to build
        });
        if (leftTargets.length === 0) {
            return;
        }

        const toBuildTargetsIds = new Set<string>([
            ...this.activelyBuildingTargetsIds,
            ...new Set(leftTargets.map(entry => entry.id || "")),
        ]);

        this.buildId++;
        await this.incrementalBuild(this.buildId, toBuildTargetsIds, context);
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
            .get("watcher.enabled", true);
        if (!isWatcherEnabled || this.terminatingExtension) {
            return false;
        }
        return true;
    }

    private isValidFile(filePath: string | undefined) {
        // Exclude Package.swift from triggering autocomplete watcher builds, as it requires to regenerate workspace which is heavy operation
        if (filePath && path.basename(filePath) === "Package.swift") {
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

    private async incrementalBuild(
        buildId: number,
        toBuildTargetIds: Set<string>,
        context:
            | { commandContext: CommandContext; includeTargets: string[]; excludeTargets: string[] }
            | undefined
    ): Promise<any> {
        const execute = async (
            context: CommandContext,
            includeTargets: string[],
            excludeTargets: string[]
        ) => {
            if (this.buildId !== buildId || (await this.isWatcherEnabledAnyFile()) === false) {
                return;
            }

            emptyAutobuildLog();
            const fileLog = getLogRelativePath("autocomplete.log");
            const buildServer = new BuildServerLogParser(this.log);
            buildServer.startParsing(context.cancellationToken, context.buildEvent);
            const rawParser = this.problemResolver.parseAsyncLogs(fileLog, context.buildEvent);
            let shouldCleanPreviousBuildErrors = true; // by default, clean previous errors
            const excludedTargetIds = this.semanticManager.getTargetIdsByNames(excludeTargets);
            const allBuildingTargetIds = new Set(
                [
                    ...Array.from(this.semanticManager.getTargetIdsByNames(includeTargets)),
                    ...Array.from(toBuildTargetIds),
                ].filter(name => name.length > 0 && !excludedTargetIds.has(name))
            );
            this.activelyBuildingTargetsIds = allBuildingTargetIds;
            try {
                this.buildTouchTime = Date.now();
                const buildManager = new BuildManager();
                await buildManager.buildAutocomplete(
                    context,
                    fileLog,
                    Array.from(allBuildingTargetIds)
                );
            } catch (error) {
                buildServer.endParsing(error);
                if (error === UserTerminatedError) {
                    shouldCleanPreviousBuildErrors = false; // do not clean previous errors if user terminated (like when a user edits a file again)
                }
                throw error;
            } finally {
                this.activelyBuildingTargetsIds.clear();
                await this.problemResolver.end(
                    context.bundle,
                    rawParser,
                    false,
                    shouldCleanPreviousBuildErrors
                );
            }
        };

        if (context === undefined) {
            try {
                await this.atomicCommand.autoWatchCommand(
                    async (context, includeTargets, excludeTargets) => {
                        await execute(context, includeTargets, excludeTargets);
                    }
                );
            } catch (err) {
                if (err === UserCommandIsExecuting) {
                    await sleep(1000);
                    if (buildId === this.buildId) {
                        // still valid
                        this.incrementalBuild(buildId, toBuildTargetIds, undefined).catch(() => {});
                    } // do nothing
                } else {
                    throw err;
                }
            }
        } else {
            // user triggered
            await execute(context.commandContext, context.includeTargets, context.excludeTargets);
        }
    }
}

function removeAllWhiteSpaces(str: string) {
    return str.replace(/\s/g, "");
}
