import {
    TargetDependency,
    ProjectManagerProjectDependency,
} from "../ProjectManager/ProjectManager";
import { setsAreEqual } from "../utils";

export enum TargetIndexStatus {
    Unknown,
    OutOfDate,
    UpToDate,
    UpToDateWithError, // build was not successful
}

export interface SemanticManagerInterface {
    statusOfTargetsForFile(
        filePath: string
    ): { id: string | undefined; targetStatus: TargetIndexStatus; lastTouchTime: number }[];

    getTargetById(targetId: string): TargetDependency | undefined;
    getTargetIdsByNames(targetNames: string[]): Set<string>;

    setImplicitDependencies(
        xcodeBuildingLogsTargetId: string,
        implicitDependencyTargetIds: string[]
    ): void;
    refreshSemanticGraph(): Promise<void>;

    markTargetOutOfDate(targetIds: Set<string>): void;
    markTargetUpToDate(targetIds: Set<string>, buildTime: number, error: Error | undefined): void;

    getAllTargetsDependencies(targetIds: Set<string>, skipTargetIds: Set<string>): Set<string>;
    getAllDependentTargets(targetIds: Set<string>): Set<string>;

    mapBuildLogsTargetIdToTargetId(xcodeBuildingLogsTargetId: string): string | undefined;

    markAllTargetsOutOfDate(): void;
}

export class SemanticManager implements SemanticManagerInterface {
    private status = new Map<string, { targetStatus: TargetIndexStatus; lastTouchTime: number }>();

    private graph = new Map<string, TargetDependency>();
    private inverseGraph = new Map<string, Set<string>>();
    private inverseGraphImplicit = new Map<string, Set<string>>();

    private filesToTargets = new Map<string, Set<string>>();
    private XcodeTargetsIdsToTargetIds = new Map<string, string>();

    constructor(private targetGraphResolver: ProjectManagerProjectDependency) {}

    statusOfTargetsForFile(
        filePath: string
    ): { id: string | undefined; targetStatus: TargetIndexStatus; lastTouchTime: number }[] {
        const targets = this.filesToTargets.get(filePath);
        if (targets === undefined) {
            return [
                {
                    id: undefined,
                    targetStatus: TargetIndexStatus.UpToDate,
                    lastTouchTime: Date.now(),
                },
            ];
        }
        return Array.from(targets).map(targetId => {
            const statusEntry = this.status.get(targetId);
            if (statusEntry === undefined) {
                return { id: targetId, targetStatus: TargetIndexStatus.Unknown, lastTouchTime: 0 };
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

    setImplicitDependencies(
        xcodeBuildingLogsTargetId: string,
        implicitDependencyTargetIds: string[]
    ): void {
        const targetId = this.XcodeTargetsIdsToTargetIds.get(xcodeBuildingLogsTargetId);
        if (!targetId) {
            return;
        }
        const targetDep = this.graph.get(targetId);
        if (targetDep) {
            for (const implicitDepId of implicitDependencyTargetIds) {
                const implicitTargetDepId = this.XcodeTargetsIdsToTargetIds.get(implicitDepId);
                if (!implicitTargetDepId || targetDep.dependencies.has(implicitTargetDepId)) {
                    continue;
                }
                targetDep.implicitDependencies.add(implicitTargetDepId);
                let inverseDeps = this.inverseGraphImplicit.get(implicitTargetDepId);
                if (!inverseDeps) {
                    inverseDeps = new Set<string>();
                    this.inverseGraphImplicit.set(implicitTargetDepId, inverseDeps);
                }
                inverseDeps.add(targetId);
            }
        }
    }

    async refreshSemanticGraph() {
        const newGraph = await this.targetGraphResolver.getTargetDependenciesGraph();

        const changedTargets = new Set<string>();
        this.filesToTargets.clear();
        this.XcodeTargetsIdsToTargetIds.clear();
        for (const [targetId, deps] of newGraph.entries()) {
            const oldTarget = this.graph.get(targetId);
            if (oldTarget !== undefined && !setsAreEqual(oldTarget.files, deps.files)) {
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
            this.XcodeTargetsIdsToTargetIds.set(deps.xcodeBuilingLogsId, targetId);
            // as deps are changing really rarely, we need to preserve old implicit deps to speed up watcher
            const implicitDeps = this.graph.get(targetId)?.implicitDependencies;
            if (implicitDeps) {
                deps.implicitDependencies = implicitDeps;
            }
        }

        this.graph = newGraph;

        this.inverseGraph.clear();
        // don't clear inverseGraphImplicit as implicit dependencies are changing really rarely and we want to preserve them to speed up watcher
        // this.inverseGraphImplicit.clear();
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
                statusEntry.targetStatus = TargetIndexStatus.OutOfDate;
                statusEntry.lastTouchTime = lastTouchTime;
            } else {
                this.status.set(targetId, {
                    targetStatus: TargetIndexStatus.OutOfDate,
                    lastTouchTime: lastTouchTime,
                });
            }
        }
    }

    markTargetUpToDate(targetIds: Set<string>, buildTime: number, error: Error | undefined) {
        for (const targetId of targetIds) {
            const statusEntry = this.status.get(targetId);
            const toUpdateStatus =
                error === undefined
                    ? TargetIndexStatus.UpToDate
                    : TargetIndexStatus.UpToDateWithError;
            if (statusEntry) {
                if (
                    statusEntry.targetStatus === TargetIndexStatus.OutOfDate &&
                    statusEntry.lastTouchTime > buildTime
                ) {
                    // if the target was modified later, skip updating to UpToDate as we need another build
                    continue;
                }
                statusEntry.targetStatus = toUpdateStatus;
                statusEntry.lastTouchTime = buildTime;
            } else {
                this.status.set(targetId, {
                    targetStatus: toUpdateStatus,
                    lastTouchTime: buildTime,
                });
            }
        }
    }

    getAllTargetsDependencies(targetIds: Set<string>, skipTargetIds: Set<string>): Set<string> {
        const result = new Set<string>();
        const visitQueue = Array.from(targetIds).filter(targetId => !skipTargetIds.has(targetId));
        while (visitQueue.length > 0) {
            const currentTargetId = visitQueue.pop()!;
            if (result.has(currentTargetId)) {
                continue;
            }
            result.add(currentTargetId);
            const targetDep = this.graph.get(currentTargetId);
            if (targetDep) {
                for (const childTargetId of targetDep.dependencies) {
                    if (!result.has(childTargetId) && !skipTargetIds.has(childTargetId)) {
                        visitQueue.push(childTargetId);
                    }
                }
                for (const childTargetId of targetDep.implicitDependencies) {
                    if (!result.has(childTargetId) && !skipTargetIds.has(childTargetId)) {
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
            const implicitDependents = this.inverseGraphImplicit.get(currentTargetId);
            if (implicitDependents) {
                for (const dependentTargetId of implicitDependents) {
                    if (!result.has(dependentTargetId)) {
                        visitQueue.push(dependentTargetId);
                    }
                }
            }
        }
        return result;
    }

    mapBuildLogsTargetIdToTargetId(xcodeBuildingLogsTargetId: string): string | undefined {
        return this.XcodeTargetsIdsToTargetIds.get(xcodeBuildingLogsTargetId);
    }

    markAllTargetsOutOfDate(): void {
        for (const statusEntry of this.status.values()) {
            statusEntry.targetStatus = TargetIndexStatus.OutOfDate;
            statusEntry.lastTouchTime = Date.now();
        }
    }
}
