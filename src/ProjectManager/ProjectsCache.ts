import * as fs from "fs";
import { getFilePathInWorkspace, isProjectFileChanged } from "../env";
import { isFolder } from "../utils";
import { ProjectWatcherInterface } from "./ProjectWatcher";

type ProjFilePath = {
    path: string;
    isFolder: boolean;
    includeAllSubfolders: boolean;
};

function isProjFilePath(obj: any): obj is ProjFilePath {
    return (
        obj &&
        typeof obj.path === "string" &&
        typeof obj.isFolder === "boolean" &&
        typeof obj.includeAllSubfolders === "boolean"
    );
}

type ProjFile = {
    list: Set<ProjFilePath>;
};
function mapReplacer(key: any, value: any) {
    if (value instanceof Map) {
        return {
            dataType: "Map",
            value: Array.from(value.entries()), // or with spread: value: [...value]
        };
    } else if (value instanceof Set) {
        return {
            dataType: "Set",
            value: [...value],
        };
    } else {
        return value;
    }
}
function mapReviver(key: any, value: any) {
    if (typeof value === "object" && value !== null) {
        if (value.dataType === "Map") {
            return new Map(value.value);
        }
        if (value.dataType === "Set") {
            const parsed = new Set(value.value);
            if (parsed.size > 0) {
                for (const v of parsed) {
                    if (!isProjFilePath(v)) {
                        throw Error("Generated Format of file is wrong");
                    }
                }
            }
            return parsed;
        }
    }
    return value;
}

export interface ProjectCacheInterface {
    clear(): void;
    preloadCacheFromFile(filePath: string): Promise<void>;
    saveCacheToFile(filePath: string): Promise<void>;
    has(project: string): boolean;
    getList(project: string, onlyFiles?: boolean): Promise<Set<string>>;
    getProjects(): string[];
    allFiles(): Promise<{ path: string; includeSubfolders: boolean }[]>;
    addProject(projectPath: string): Promise<void>;
}

export class ProjectsCache implements ProjectCacheInterface {
    private cache = new Map<string, ProjFile>();

    listFilesFromProject: (projectFile: string) => Promise<string[]>;

    constructor(
        private readonly projectWatcher: ProjectWatcherInterface,
        listFilesFromProject: (projectFile: string) => Promise<string[]>
    ) {
        this.listFilesFromProject = listFilesFromProject;
    }

    clear() {
        this.cache.clear();
    }

    async preloadCacheFromFile(filePath: string) {
        return new Promise<void>((resolve, reject) => {
            fs.readFile(filePath, (e, data) => {
                if (e === null) {
                    try {
                        const val = JSON.parse(data.toString(), mapReviver);
                        if (val instanceof Map) {
                            this.cache = val;
                        } else {
                            reject(Error("Json format is wrong"));
                        }
                        resolve();
                    } catch (err) {
                        console.log(`Preload Cache from file error: ${err}`);
                        reject(err);
                    }
                } else {
                    reject(e);
                }
            });
        });
    }

    async saveCacheToFile(filePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const proj = JSON.stringify(this.cache, mapReplacer, 4);
            fs.writeFile(filePath, proj, e => {
                if (e === null) {
                    resolve();
                } else {
                    reject(e);
                }
            });
        });
    }

    private async getFilesForProject(projectPath: string) {
        if (await isProjectFileChanged(projectPath, "ProjectsCache", this.projectWatcher)) {
            const list = await this.parseProjectList(
                await this.listFilesFromProject(getFilePathInWorkspace(projectPath))
            );
            this.cache.set(projectPath, { list });
        }
        return this.cache.get(projectPath)?.list;
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
        }
    }
}
