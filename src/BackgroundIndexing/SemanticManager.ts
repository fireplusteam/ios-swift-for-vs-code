import {
    TargetDependency,
    ProjectManagerProjectDependency,
} from "../ProjectManager/ProjectManager";
import { setsAreEqual } from "../utils";

export enum TargetIndexStatus {
    Unknown,
    OutOfDate,
    UpToDate,
}

export interface SemanticManagerInterface {
    statusOfTargetsForFile(
        filePath: string
    ): { id: string | undefined; targetStatus: TargetIndexStatus; lastTouchTime: number }[];

    getTargetById(targetId: string): TargetDependency | undefined;
    getTargetIdsByNames(targetNames: string[]): Set<string>;

    refreshSemanticGraph(): Promise<void>;

    markTargetOutOfDate(targetIds: Set<string>): void;
    markTargetUpToDate(targetIds: Set<string>, buildTime: number): void;

    getAllTargetsDependencies(targetIds: Set<string>): Set<string>;
    getAllDependentTargets(targetIds: Set<string>): Set<string>;

    markAllTargetsOutOfDate(): void;
}

export class SemanticManager implements SemanticManagerInterface {
    private status = new Map<string, { targetStatus: TargetIndexStatus; lastTouchTime: number }>();

    private graph = new Map<string, TargetDependency>();
    private inverseGraph = new Map<string, Set<string>>();

    private filesToTargets = new Map<string, Set<string>>();

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

    async refreshSemanticGraph() {
        const newGraph = await this.targetGraphResolver.getTargetDependenciesGraph();

        const changedTargets = new Set<string>();
        this.filesToTargets.clear();
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

    markTargetUpToDate(targetIds: Set<string>, buildTime: number) {
        for (const targetId of targetIds) {
            const statusEntry = this.status.get(targetId);
            if (statusEntry) {
                if (
                    statusEntry.targetStatus === TargetIndexStatus.OutOfDate &&
                    statusEntry.lastTouchTime > buildTime
                ) {
                    // if the target was modified later, skip updating to UpToDate as we need another build
                    continue;
                }
                statusEntry.targetStatus = TargetIndexStatus.UpToDate;
                statusEntry.lastTouchTime = buildTime;
            } else {
                this.status.set(targetId, {
                    targetStatus: TargetIndexStatus.UpToDate,
                    lastTouchTime: buildTime,
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

    markAllTargetsOutOfDate(): void {
        for (const statusEntry of this.status.values()) {
            statusEntry.targetStatus = TargetIndexStatus.OutOfDate;
            statusEntry.lastTouchTime = Date.now();
        }
    }
}
