import * as vscode from "vscode";
import { getFilePathInWorkspace, isProjectFileChanged } from "../env";
import { isFolder } from "../utils";
import { ProjectWatcherInterface } from "./ProjectWatcher";
import { glob } from "glob";
import { statSync } from "fs";

type ProjFilePath = {
    path: string;
    isFolder: boolean;
    includeAllSubfolders: boolean;
};

type ProjFile = {
    list: Set<ProjFilePath>;
};

export interface ProjectCacheInterface extends vscode.Disposable {
    has(project: string): boolean;
    getList(project: string, onlyFiles?: boolean): Promise<Set<string>>;
    getProjects(): string[];
    allFiles(): Promise<{ path: string; includeSubfolders: boolean }[]>;

    getProjectTargets(projectFile: string): Promise<string[]>;
    getProjectTestsTargets(projectFile: string): Promise<string[]>;
    listFilesFromTarget(projectFile: string, targetName: string): Promise<string[]>;
    listDependenciesForTarget(projectFile: string, targetName: string): Promise<string[]>;

    addProject(projectPath: string): Promise<boolean>;

    getFilesInFolder(folderPath: string): Promise<string[]>;
}

export class ProjectsCache implements ProjectCacheInterface {
    private cache = new Map<string, ProjFile>();
    private cacheTargetsForProject = new Map<string, string[]>();
    private cacheTestsTargetsForProject = new Map<string, string[]>();
    private cacheFilesFromProjectAndTarget = new Map<string, string[]>();
    private cacheDependenciesForTarget = new Map<string, string[]>();

    _listFilesFromProject: (projectFile: string) => Promise<string[]>;
    _listFilesFromTarget: (projectFile: string, targetName: string) => Promise<string[]>;
    _getProjectTargets: (projectFile: string) => Promise<string[]>;
    _getProjectTestsTargets: (projectFile: string) => Promise<string[]>;
    _listDependenciesForTarget: (projectFile: string, targetName: string) => Promise<string[]>;

    constructor(
        private readonly projectWatcher: ProjectWatcherInterface,
        listFilesFromProject: (projectFile: string) => Promise<string[]>,
        getProjectTargets: (projectFile: string) => Promise<string[]>,
        getProjectTestsTargets: (projectFile: string) => Promise<string[]>,
        listFilesFromTarget: (projectFile: string, targetName: string) => Promise<string[]>,
        listDependenciesForTarget: (projectFile: string, targetName: string) => Promise<string[]>
    ) {
        this._listFilesFromProject = listFilesFromProject;
        this._listFilesFromTarget = listFilesFromTarget;
        this._getProjectTargets = getProjectTargets;
        this._getProjectTestsTargets = getProjectTestsTargets;
        this._listDependenciesForTarget = listDependenciesForTarget;
    }

    dispose() {
        this.cache.clear();
        this.cacheTargetsForProject.clear();
        this.cacheTestsTargetsForProject.clear();
        this.cacheFilesFromProjectAndTarget.clear();
        this.cacheDependenciesForTarget.clear();
    }

    private async getFilesForProject(projectPath: string) {
        if (await isProjectFileChanged(projectPath, "ProjectsCache.files", this.projectWatcher)) {
            const list = await this.parseProjectList(
                await this._listFilesFromProject(getFilePathInWorkspace(projectPath))
            );
            this.cache.set(projectPath, { list });
        }
        return this.cache.get(projectPath)?.list;
    }

    private async getFilesForTarget(projectPath: string, targetName: string) {
        const cacheKey = `${projectPath}|${targetName}`;
        if (
            await isProjectFileChanged(
                projectPath,
                `ProjectsCache.targetFiles.${targetName}`,
                this.projectWatcher
            )
        ) {
            const list = await this._listFilesFromTarget(projectPath, targetName);
            this.cacheFilesFromProjectAndTarget.set(cacheKey, list);
        }
        return this.cacheFilesFromProjectAndTarget.get(cacheKey);
    }

    async getProjectTargets(projectPath: string) {
        if (await isProjectFileChanged(projectPath, "ProjectsCache.targets", this.projectWatcher)) {
            const list = await this._getProjectTargets(projectPath);
            this.cacheTargetsForProject.set(projectPath, list);
        }
        return this.cacheTargetsForProject.get(projectPath) || [];
    }

    async getProjectTestsTargets(projectPath: string) {
        if (
            await isProjectFileChanged(
                projectPath,
                "ProjectsCache.testsTargets",
                this.projectWatcher
            )
        ) {
            const list = await this._getProjectTestsTargets(projectPath);
            this.cacheTestsTargetsForProject.set(projectPath, list);
        }
        return this.cacheTestsTargetsForProject.get(projectPath) || [];
    }

    async listFilesFromTarget(projectFile: string, targetName: string): Promise<string[]> {
        return (await this.getFilesForTarget(projectFile, targetName)) || [];
    }

    async listDependenciesForTarget(projectFile: string, targetName: string): Promise<string[]> {
        const cacheKey = `${projectFile}|${targetName}`;
        if (
            await isProjectFileChanged(
                projectFile,
                `ProjectsCache.dependenciesForTarget.${targetName}`,
                this.projectWatcher
            )
        ) {
            const list = await this._listDependenciesForTarget(projectFile, targetName);
            this.cacheDependenciesForTarget.set(cacheKey, list);
        }
        return this.cacheDependenciesForTarget.get(cacheKey) || [];
    }

    has(project: string) {
        return this.cache.has(project);
    }

    async getList(project: string, onlyFiles = true) {
        const res = new Set<string>();
        const projectList = await this.getFilesForProject(project);
        if (!projectList) {
            return res;
        }
        for (const file of projectList) {
            if (!file.isFolder || !onlyFiles) {
                res.add(file.path);
            }
        }
        return res;
    }

    getProjects() {
        const projects: string[] = [];
        for (const proj of this.cache) {
            projects.push(proj[0]);
        }
        return projects;
    }

    async allFiles(): Promise<{ path: string; isFolder: boolean; includeSubfolders: boolean }[]> {
        const files: { path: string; isFolder: boolean; includeSubfolders: boolean }[] = [];
        for (const project of this.cache.keys()) {
            const list = await this.getFilesForProject(project);
            for (const file of list || []) {
                files.push({
                    path: file.path,
                    isFolder: file.isFolder,
                    includeSubfolders: file.includeAllSubfolders,
                });
            }
        }
        return files;
    }

    private async parseProjectList(files: string[]) {
        const resPaths = new Set<{
            path: string;
            isFolder: boolean;
            includeAllSubfolders: boolean;
        }>();
        const isFolderImp = (filePath: string) => {
            try {
                return isFolder(filePath);
            } catch {
                return false;
            }
        };
        for (const file of files) {
            if (file.startsWith("group:/")) {
                const filePath = file.substring("group:".length);
                resPaths.add({
                    path: filePath,
                    isFolder: isFolderImp(filePath),
                    includeAllSubfolders: false,
                });
            } else if (file.startsWith("file:/")) {
                const filePath = file.substring("file:".length);
                resPaths.add({
                    path: filePath,
                    isFolder: isFolderImp(filePath),
                    includeAllSubfolders: false,
                });
            } else if (file.startsWith("folder:/")) {
                const filePath = file.substring("folder:".length);
                resPaths.add({
                    path: filePath,
                    isFolder: isFolderImp(filePath),
                    includeAllSubfolders: true,
                });
            } else {
                console.log(`unsupported file ${file}`);
            }
        }
        return resPaths;
    }

    async addProject(projectPath: string) {
        if (!this.cache.has(projectPath)) {
            this.cache.set(projectPath, {
                list: new Set<ProjFilePath>(),
            });
            return true;
        }
        return false;
    }

    private cacheFolderFiles = new Map<
        string,
        { files: string[]; fingerprint: number | undefined }
    >();
    async getFilesInFolder(folderPath: string) {
        const mstat = getFolderFingerprint(folderPath)?.getTime();
        if (mstat === undefined || mstat !== this.cacheFolderFiles.get(folderPath)?.fingerprint) {
            const files: string[] = await glob("*", {
                absolute: true,
                cwd: folderPath,
                dot: true,
                nodir: false,
                ignore: "**/{.git,.svn,.hg,CVS,.DS_Store,Thumbs.db,.gitkeep,.gitignore}",
            });
            this.cacheFolderFiles.set(folderPath, { files, fingerprint: mstat });
        }
        return this.cacheFolderFiles.get(folderPath)?.files || [];
    }
}

function getFolderFingerprint(folderPath: string) {
    try {
        const stats = statSync(folderPath);
        return stats.mtime;
    } catch {
        return undefined;
    }
}
