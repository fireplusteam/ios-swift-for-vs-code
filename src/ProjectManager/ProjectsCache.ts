import * as fs from "fs";
import { getFilePathInWorkspace } from "../env";
import { listFilesFromProject } from "./ProjectManager";
import { watch } from "fs";
import path from "path";
import * as vscode from "vscode";

type ProjFilePath = {
    path: string;
    isFolder: boolean;
};

function isProjFilePath(obj: any): obj is ProjFilePath {
    return obj && typeof obj.path === "string" && typeof obj.isFolder === "boolean";
}

type ProjFile = {
    timestamp: number;
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
export class ProjectsCache {
    private cache = new Map<string, ProjFile>();
    private watcher = new Map<string, { watcher: fs.FSWatcher; content: Buffer }>();

    onProjectChanged = new vscode.EventEmitter<void>();

    constructor() {}

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
                        console.log(err);
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

    has(project: string) {
        return this.cache.has(project);
    }

    getList(project: string, onlyFiles = true) {
        const res = new Set<string>();
        const projectList = this.cache.get(project)?.list;
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

    files(isFolder = false) {
        const files: string[] = [];
        for (const [, value] of this.cache) {
            for (const file of value.list) {
                if (file.isFolder === isFolder) {
                    files.push(file.path);
                }
            }
        }
        return files;
    }

    async parseProjectList(files: string[]) {
        const resPaths = new Set<{ path: string; isFolder: boolean }>();
        for (const file of files) {
            if (file.startsWith("group:/")) {
                resPaths.add({ path: file.substring("group:".length), isFolder: true });
            } else if (file.startsWith("file:/")) {
                resPaths.add({ path: file.substring("file:".length), isFolder: false });
            } else {
                console.log(`unsupported file ${file}`);
            }
        }
        return resPaths;
    }

    async update(projectPath: string, contentFile: Buffer | undefined = undefined) {
        const time = fs.statSync(getFilePathInWorkspace(projectPath)).mtimeMs;
        let updated = false;
        if (!this.cache.has(projectPath) || time !== this.cache.get(projectPath)?.timestamp) {
            this.cache.set(projectPath, {
                timestamp: time,
                list: await this.parseProjectList(
                    await listFilesFromProject(getFilePathInWorkspace(projectPath))
                ),
            });
            updated = true;
        }
        if (!this.watcher.has(projectPath)) {
            const fullProjectPath = path.join(
                getFilePathInWorkspace(projectPath),
                "project.pbxproj"
            );
            const fileWatch = watch(fullProjectPath, null);
            fileWatch.on("change", async () => {
                const contentFile = fs.readFileSync(fullProjectPath);

                if (contentFile.toString() === this.watcher.get(projectPath)?.content.toString()) {
                    this.watcher.get(projectPath)?.watcher.close();
                    this.watcher.delete(projectPath);
                    await this.update(projectPath, contentFile);
                    return;
                }
                this.watcher.get(projectPath)?.watcher.close();
                this.watcher.delete(projectPath);
                if (!fs.existsSync(getFilePathInWorkspace(projectPath))) {
                    this.cache.delete(projectPath);
                    return;
                }
                await this.update(projectPath);
                this.onProjectChanged.fire();
            });
            const contentProjectFile =
                contentFile === undefined ? fs.readFileSync(fullProjectPath) : contentFile;
            this.watcher.set(projectPath, { watcher: fileWatch, content: contentProjectFile });
        }
        return updated;
    }
}
