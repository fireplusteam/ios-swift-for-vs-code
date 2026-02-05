import * as vscode from "vscode";
import { getLogRelativePath, getWorkspaceFolder, isActivated } from "./env";
import { emptyAutobuildLog } from "./utils";
import { sleep } from "./utils";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { AtomicCommand, UserCommandIsExecuting } from "./CommandManagement/AtomicCommand";
import { BuildManager } from "./Services/BuildManager";
import { CommandContext, UserTerminatedError } from "./CommandManagement/CommandContext";
import { BuildServerLogParser } from "./LSP/LSPBuildServerLogParser";
import { LogChannelInterface } from "./Logs/LogChannel";
import * as path from "path";
import { ProjectManagerProjectDependency, TargetDependency } from "./ProjectManager/ProjectManager";

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
        private semanticManager: SemanticManager,
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

                this.triggerIncrementalBuild(doc.document.uri);
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
                const fileTargets = new Set(
                    this.semanticManager.statusOf(doc.uri.fsPath).map(target => target.id || "")
                );

                // all dependent targets except the file targets
                const dependentTargets = Array.from(
                    this.semanticManager.getAllDependentTargets(fileTargets)
                ).filter(targetId => !fileTargets.has(targetId));
                this.semanticManager.markTargetOutOfDate(new Set(dependentTargets));
            })
        );
        this.problemResolver = problemResolver;
    }

    async triggerIncrementalBuild(
        file: vscode.Uri | undefined,
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
            .statusOf(file.fsPath)
            .filter(entry => entry.targetStatus !== Status.UpToDate);
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
            try {
                const excludedTargetIds = this.semanticManager.getTargetIdsByNames(excludeTargets);
                const allBuildingTargetIds = new Set(
                    [
                        ...Array.from(this.semanticManager.getTargetIdsByNames(includeTargets)),
                        ...Array.from(toBuildTargetIds),
                    ].filter(name => name.length > 0 && !excludedTargetIds.has(name))
                );

                this.activelyBuildingTargetsIds = allBuildingTargetIds;

                this.buildTouchTime = Date.now();
                const buildManager = new BuildManager();
                await buildManager.buildAutocomplete(
                    context,
                    fileLog,
                    Array.from(allBuildingTargetIds)
                );

                // mark all built targets and their dependencies as up to date if they were not modified during the build
                const allBuiltTargetsIds =
                    this.semanticManager.getAllTargetsDependencies(allBuildingTargetIds);
                this.semanticManager.markTargetUpToDate(allBuiltTargetsIds, this.buildTouchTime);
                this.activelyBuildingTargetsIds.clear();
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

enum Status {
    Unknown,
    OutOfDate,
    UpToDate,
}

export class SemanticManager {
    private status = new Map<string, { targetStatus: Status; lastTouchTime: number }>();

    private graph = new Map<string, TargetDependency>();
    private inverseGraph = new Map<string, Set<string>>();

    private filesToTargets = new Map<string, Set<string>>();

    constructor(private targetGraphResolver: ProjectManagerProjectDependency) {}

    statusOf(
        filePath: string
    ): { id: string | undefined; targetStatus: Status; lastTouchTime: number }[] {
        const targets = this.filesToTargets.get(filePath);
        if (targets === undefined) {
            return [{ id: undefined, targetStatus: Status.UpToDate, lastTouchTime: Date.now() }];
        }
        return Array.from(targets).map(targetId => {
            const statusEntry = this.status.get(targetId);
            if (statusEntry === undefined) {
                return { id: targetId, targetStatus: Status.Unknown, lastTouchTime: 0 };
            }
            return {
                id: targetId,
                targetStatus: statusEntry.targetStatus,
                lastTouchTime: statusEntry.lastTouchTime,
            };
        });
    }

    getTargetById(targetId: string): TargetDependency | undefined {
        return this.graph.get(targetId);
    }

    getTargetIdsByNames(targetNames: string[]): Set<string> {
        const result = new Set<string>();
        for (const [targetId, deps] of this.graph.entries()) {
            if (targetNames.includes(deps.targetName)) {
                result.add(targetId);
            }
        }
        return result;
    }

    async refreshSemanticGraph() {
        const newGraph = await this.targetGraphResolver.getTargetDependenciesGraph();

        const changedTargets = new Set<string>();
        this.filesToTargets.clear();
        for (const [targetId, deps] of newGraph.entries()) {
            const oldTarget = this.graph.get(targetId);
            if (oldTarget !== undefined && oldTarget.files !== deps.files) {
                changedTargets.add(targetId);
            } else if (oldTarget === undefined) {
                changedTargets.add(targetId);
            }
            for (const file of deps.files) {
                let targets = this.filesToTargets.get(file);
                if (!targets) {
                    targets = new Set<string>();
                    this.filesToTargets.set(file, targets);
                }
                targets.add(targetId);
            }
        }

        this.graph = newGraph;

        this.inverseGraph.clear();
        for (const [targetId, deps] of this.graph.entries()) {
            for (const dependencyId of deps.dependencies) {
                let inverseDeps = this.inverseGraph.get(dependencyId);
                if (!inverseDeps) {
                    inverseDeps = new Set<string>();
                    this.inverseGraph.set(dependencyId, inverseDeps);
                }
                inverseDeps.add(targetId);
            }
        }

        const allChangedTargets = this.getAllDependentTargets(changedTargets);
        this.markTargetOutOfDate(allChangedTargets);
    }

    markTargetOutOfDate(targetIds: Set<string>) {
        const lastTouchTime = Date.now();
        for (const targetId of targetIds) {
            const statusEntry = this.status.get(targetId);
            if (statusEntry) {
                statusEntry.targetStatus = Status.OutOfDate;
                statusEntry.lastTouchTime = lastTouchTime;
            } else {
                this.status.set(targetId, {
                    targetStatus: Status.OutOfDate,
                    lastTouchTime: lastTouchTime,
                });
            }
        }
    }

    markTargetUpToDate(targetIds: Set<string>, touchTime: number) {
        for (const targetId of targetIds) {
            const statusEntry = this.status.get(targetId);
            if (statusEntry) {
                if (
                    statusEntry.targetStatus === Status.OutOfDate &&
                    statusEntry.lastTouchTime > touchTime
                ) {
                    // if the target was modified later, skip updating to UpToDate as we need another build
                    continue;
                }
                statusEntry.targetStatus = Status.UpToDate;
                statusEntry.lastTouchTime = touchTime;
            } else {
                this.status.set(targetId, {
                    targetStatus: Status.UpToDate,
                    lastTouchTime: touchTime,
                });
            }
        }
    }

    getAllTargetsDependencies(targetIds: Set<string>): Set<string> {
        const result = new Set<string>();
        const visitQueue = Array.from(targetIds);
        while (visitQueue.length > 0) {
            const currentTargetId = visitQueue.pop()!;
            if (result.has(currentTargetId)) {
                continue;
            }
            result.add(currentTargetId);
            const targetDep = this.graph.get(currentTargetId);
            if (targetDep) {
                for (const childTargetId of targetDep.dependencies) {
                    if (!result.has(childTargetId)) {
                        visitQueue.push(childTargetId);
                    }
                }
            }
        }
        return result;
    }

    getAllDependentTargets(targetIds: Set<string>): Set<string> {
        const result = new Set<string>();
        const visitQueue = Array.from(targetIds);
        while (visitQueue.length > 0) {
            const currentTargetId = visitQueue.pop()!;
            if (result.has(currentTargetId)) {
                continue;
            }
            result.add(currentTargetId);
            const dependents = this.inverseGraph.get(currentTargetId);
            if (dependents) {
                for (const dependentTargetId of dependents) {
                    if (!result.has(dependentTargetId)) {
                        visitQueue.push(dependentTargetId);
                    }
                }
            }
        }
        return result;
    }
}
