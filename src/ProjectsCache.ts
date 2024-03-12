import * as fs from 'fs';
import { getFilePathInWorkspace } from "./env";
import { listFilesFromProject } from "./ProjectManager";
import { watch } from "fs";
import path from 'path';

type ProjFile = {
    timestamp: number;
    list: Set<string>;
};
function mapReplacer(key: any, value: any) {
    if (value instanceof Map) {
        return {
            dataType: 'Map',
            value: Array.from(value.entries()), // or with spread: value: [...value]
        };
    } else if (value instanceof Set) {
        return {
            dataType: "Set",
            value: [...value]
        };
    } else {
        return value;
    }
}
function mapReviver(key: any, value: any) {
    if (typeof value === 'object' && value !== null) {
        if (value.dataType === 'Map') {
            return new Map(value.value);
        }
        if (value.dataType === "Set") {
            return new Set(value.value);
        }
    }
    return value;
}
export class ProjectsCache {
    private cache = new Map<string, ProjFile>();
    private watcher = new Map<string, fs.FSWatcher>();

    constructor() { }

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
                            reject(new Error("Json format is wrong"));
                        }
                        resolve();
                    } catch (err) {
                        console.log(err);
                        reject(err);
                    }
                }
                else {
                    reject(e);
                }
            });
        });
    }

    async saveCacheToFile(filePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const proj = JSON.stringify(this.cache, mapReplacer, 4);
            fs.writeFile(filePath, proj, e => {
                if (e === null)
                    resolve();
                else {
                    reject(e);
                }
            });
        });
    }

    has(project: string) {
        return this.cache.has(project);
    }

    getList(project: string) {
        return this.cache.get(project)?.list || new Set<string>();
    }

    getProjects() {
        let projects: string[] = [];
        for (let proj of this.cache) {
            projects.push(proj[0]);
        }
        return projects;
    }

    files() {
        const files: string[] = [];
        for (let [key, value] of this.cache) {
            for (let file of value.list) {
                files.push(file);
            }
        }
        return files;
    }

    async update(projectPath: string) {
        const time = fs.statSync(getFilePathInWorkspace(projectPath)).mtimeMs;
        if (!this.cache.has(projectPath) || time !== this.cache.get(projectPath)?.timestamp) {
            this.cache.set(projectPath, {
                timestamp: time,
                list: new Set<string>(await listFilesFromProject(getFilePathInWorkspace(projectPath)))
            });
        }
        if (!this.watcher.has(projectPath)) {
            const fileWatch = watch(path.join(getFilePathInWorkspace(projectPath), "project.pbxproj"), null
            );
            fileWatch.on("change", e => {
                this.watcher.delete(projectPath);
                this.update(projectPath);
            });
            this.watcher.set(
                projectPath,
                fileWatch
            );
        }
    }
}
