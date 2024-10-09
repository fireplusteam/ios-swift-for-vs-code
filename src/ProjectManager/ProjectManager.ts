import * as vscode from "vscode";
import * as fs from "fs";
import {
    getBuildRootPath,
    getFilePathInWorkspace,
    getProjectFileName,
    getProjectFolderPath,
    getProjectPath,
    getWorkspaceId,
    getWorkspacePath,
    isActivated,
} from "../env";
import * as parser from "fast-xml-parser";
import { exec } from "child_process";
import path from "path";
import { fileNameFromPath, isFileMoved, isFolder } from "../utils";
import { ProjectTree } from "./ProjectTree";
import { glob } from "glob";
import { ProjectsCache } from "./ProjectsCache";
import { error } from "console";
import { QuickPickItem, showPicker } from "../inputPicker";
import { XcodeProjectFileProxy } from "./XcodeProjectFileProxy";

export class ProjectManager {
    private disposable: vscode.Disposable[] = [];

    private projectCache = new ProjectsCache();

    onProjectUpdate = new vscode.EventEmitter<void>();
    onProjectLoaded = new vscode.EventEmitter<void>();
    onUpdateDeps: (() => Promise<void>) | undefined;

    constructor() {
        this.disposable.push(
            vscode.workspace.onDidCreateFiles(async e => {
                this.addAFileToXcodeProject([...e.files]);
                console.log("Create a new file");
            })
        );

        this.disposable.push(
            vscode.workspace.onDidRenameFiles(e => {
                this.renameFile(
                    e.files.map(f => {
                        return f.oldUri;
                    }),
                    e.files.map(f => {
                        return f.newUri;
                    })
                );
                console.log("Renamed");
            })
        );

        this.disposable.push(
            vscode.workspace.onDidDeleteFiles(e => {
                this.deleteFileFromXcodeProject([...e.files]);
                console.log("Deleted");
            })
        );
        this.disposable.push(
            this.projectCache.onProjectChanged.event(() => {
                this.touch();
            })
        );

        fs.mkdirSync(getFilePathInWorkspace(this.cachePath()), { recursive: true });
    }

    async listTargetsForFile(file: string, project: string | undefined = undefined) {
        const schemeType = getProjectType(await getProjectFileName());
        if (schemeType === "-package") {
            return await new Promise<string[]>(resolve => {
                const pathParts = file.split(path.sep);
                for (let i = pathParts.length - 1; i >= 0; --i) {
                    if (pathParts[i] === "Sources" || pathParts[i] === "Tests") {
                        resolve([pathParts[i + 1]]);
                        return;
                    }
                }
                resolve([]);
            });
        }
        const projects = project === undefined ? this.projectCache.getProjects() : [project];
        for (const project of projects) {
            if (this.projectCache.getList(project).has(file)) {
                return (await listTargetsForFile(getFilePathInWorkspace(project), file)).filter(
                    e => {
                        return e.length > 0;
                    }
                );
            }
        }
        return [];
    }

    async loadProjectFiles(shouldDropCache = false) {
        if (!this.isAllowed()) {
            if (await isActivated()) {
                setTimeout(() => {
                    this.onProjectLoaded.fire();
                }, 100);
                return;
            }
            return;
        }
        if (shouldDropCache) {
            this.projectCache.clear();
        } else {
            try {
                await this.projectCache.preloadCacheFromFile(await this.xCodeCachePath());
            } catch (err) {
                console.log(`Project files cache is broken ${err}`);
            }
        }

        const projects = await getProjectFiles(await getProjectPath());

        const wasLoadedWithError = [] as string[];
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: "Loading Project" },
            async progress => {
                for (const [index, project] of projects.entries()) {
                    progress.report({
                        increment: (100 * index) / (project.length + 1),
                        message: fileNameFromPath(project),
                    });
                    try {
                        await this.projectCache.update(project);
                        await this.readAllProjects(this.projectCache.getList(project));
                    } catch {
                        console.log(error);
                        wasLoadedWithError.push(fileNameFromPath(project));
                    }
                }
                progress.report({ increment: 1, message: "Generating workspace..." });
                await this.generateWorkspace();
            }
        );

        if (wasLoadedWithError.length > 0) {
            const option = await vscode.window.showErrorMessage(
                `Projects were loaded with ERRORS: ${wasLoadedWithError.join(", ")}. Update dependencies and retry?`,
                "Update Dependencies",
                "Cancel"
            );
            if (option === "Update Dependencies" && this.onUpdateDeps !== undefined) {
                await this.onUpdateDeps();
                this.loadProjectFiles(shouldDropCache);
            }
        }
    }

    private async readAllProjects(files: Set<string>) {
        for (const file of files) {
            if (file.endsWith(".xcodeproj")) {
                const relativeProjectPath = path.relative(getWorkspacePath(), file);
                if (await this.projectCache.update(relativeProjectPath)) {
                    await this.readAllProjects(this.projectCache.getList(relativeProjectPath));
                }
            }
        }
    }

    private async generateWorkspace() {
        const projectTree = new ProjectTree();

        // add all project first as they are visible
        for (const file of [
            ...this.projectCache.files(),
            ...(await this.getAdditionalIncludedFiles()),
        ]) {
            projectTree.addIncluded(file);
        }
        for (const folder of [...this.projectCache.files(true)]) {
            projectTree.addIncluded(folder, false);
        }
        projectTree.addIncluded(getFilePathInWorkspace(".vscode"));
        projectTree.addIncluded(getFilePathInWorkspace(".logs"));
        projectTree.addIncluded(getFilePathInWorkspace((await this.getProjects()).at(0) || ""));

        // now try to go over all subfolder and exclude every single file which is not in the project files
        const visitedFolders = new Set<string>();
        for (const file of [
            getWorkspacePath(),
            ...this.projectCache.files(),
            ...this.projectCache.files(true),
        ]) {
            const relative = path.relative(getWorkspacePath(), file);
            if (relative.startsWith("..")) {
                continue;
            }
            const components = relative.split(path.sep);
            let compPath = "";
            for (let i = 0; i < components.length; ++i) {
                compPath = path.join(compPath, components[i]);
                if (!visitedFolders.has(compPath)) {
                    visitedFolders.add(compPath);
                    try {
                        const files = await glob("*", {
                            absolute: true,
                            cwd: path.join(getWorkspacePath(), compPath),
                            dot: true,
                            nodir: false,
                            ignore: "**/{.git,.svn,.hg,CVS,.DS_Store,Thumbs.db,.gitkeep,.gitignore}",
                        });
                        for (const file of files) {
                            projectTree.addExcluded(file);
                        }
                    } catch (err) {
                        console.log(`Glob pattern is configured wrong: ${err}`);
                    }
                }
            }
        }

        // Generate json and dump to files
        const excludedFiles = projectTree.excludedFiles();
        const excludedFilesDict: { [key: string]: boolean } = {};
        for (const file of excludedFiles) {
            const relative = path.relative(getWorkspacePath(), file);
            excludedFilesDict[relative] = true;
        }
        const workspaceName = `${getWorkspacePath().split(path.sep).at(-1)}/${await getProjectFileName()}`;
        const xCodeWorkspace = {
            folders: [
                {
                    name: workspaceName,
                    path: "../..",
                },
            ],
            settings: {
                "files.exclude": excludedFilesDict,
                "search.exclude": excludedFilesDict,
                // we use own lsp client, so we don't need to interfere with it
                "swift.autoGenerateLaunchConfigurations": false,
                "swift.disableAutoResolve": true,
                "swift.sourcekit-lsp.disable": true,
            },
            extensions: {
                // tell vs code not to recommend it as it interfere with this extension
                unwantedRecommendations: ["sswg.swift-lang"],
            },
        };
        const buildRootPath = getBuildRootPath();
        if (buildRootPath !== undefined) {
            xCodeWorkspace.folders.push({
                name: "Dependencies",
                path: path.join(buildRootPath, "SourcePackages", "checkouts"),
            });
        }

        await this.projectCache.saveCacheToFile(await this.xCodeCachePath());
        await this.saveWorkspace(xCodeWorkspace);
    }

    private async getAdditionalIncludedFiles() {
        try {
            const json = fs.readFileSync(
                path.join(
                    getWorkspacePath(),
                    `${(await getProjectFileName()).split(".").slice(0, -1).join(".")}.files.json`
                ),
                "utf-8"
            );

            const obj = JSON.parse(json);
            const resFiles = new Set<string>();

            for (const pattern of obj.files) {
                const cwd = path.join(
                    getFilePathInWorkspace(await getProjectFolderPath()),
                    pattern.search.cwd
                );
                const files = await glob(pattern.search.include, {
                    absolute: true,
                    cwd: cwd,
                    dot: pattern.search.dot,
                    nodir: pattern.search.nodir,
                    ignore: pattern.search.ignore,
                });
                for (const file of files) {
                    resFiles.add(file);
                }
            }

            return resFiles;
        } catch (err) {
            console.log(err);
            return new Set<string>();
        }
    }

    private async saveWorkspace(workspace: unknown) {
        const json = JSON.stringify(workspace, null, 4);
        return new Promise<void>(async (resolve, reject) => {
            fs.writeFile(await this.xCodeWorkspacePath(), json, async e => {
                console.log(e);
                try {
                    if (e === null) {
                        if (
                            vscode.workspace.workspaceFile?.fsPath !==
                            (await this.xCodeWorkspacePath())
                        ) {
                            await this.openXCodeWorkspace(await this.xCodeWorkspacePath());
                            reject(new Error("Opening in Workspace")); // xcode workspace is reloading, reject further execution
                            return;
                        } else {
                            this.onProjectLoaded.fire();
                        }
                        resolve();
                    } else {
                        reject(error);
                    }
                } catch (err) {
                    reject(err);
                }
            });
        });
    }

    private cachePath() {
        return ".vscode/xcode";
    }

    private async xCodeCachePath() {
        return getFilePathInWorkspace(
            path.join(this.cachePath(), `${await getWorkspaceId()}_projects.json`)
        );
    }

    private async xCodeWorkspacePath() {
        return getFilePathInWorkspace(
            path.join(this.cachePath(), `${await getWorkspaceId()}.code-workspace`)
        );
    }

    private async openXCodeWorkspace(file: string) {
        await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(file));
    }

    private async isAllowed() {
        if ((await isActivated()) === false) {
            return false;
        }
        if ((await getProjectFileName()) === "Package.swift") {
            return false;
        }
        return true;
    }

    private async renameFile(oldFiles: vscode.Uri[], files: vscode.Uri[]) {
        if (!this.isAllowed()) {
            if (await isActivated()) {
                this.onProjectUpdate.fire();
                return;
            }
            return;
        }

        const modifiedProjects = new Set<string>();
        try {
            const projectFiles = this.projectCache.getProjects();
            for (let i = 0; i < oldFiles.length; ++i) {
                const file = files[i];
                const oldFile = oldFiles[i];
                const selectedProject = await this.determineProjectFile(file.fsPath, projectFiles);

                for (const project of selectedProject) {
                    try {
                        modifiedProjects.add(project);
                        if (isFolder(file.fsPath)) {
                            // rename folder
                            if (isFileMoved(oldFile.fsPath, file.fsPath)) {
                                await moveFolderToProject(
                                    getFilePathInWorkspace(project),
                                    oldFile.fsPath,
                                    file.fsPath
                                );
                            } else {
                                await renameFolderToProject(
                                    getFilePathInWorkspace(project),
                                    oldFile.fsPath,
                                    file.fsPath
                                );
                            }
                        } else {
                            if (isFileMoved(oldFile.fsPath, file.fsPath)) {
                                await moveFileToProject(
                                    getFilePathInWorkspace(project),
                                    oldFile.fsPath,
                                    file.fsPath
                                );
                            } else {
                                await renameFileToProject(
                                    getFilePathInWorkspace(project),
                                    oldFile.fsPath,
                                    file.fsPath
                                );
                            }
                        }
                    } catch (err) {
                        console.log(err);
                    }
                }
            }
        } finally {
            for (const project of modifiedProjects) {
                await saveProject(getFilePathInWorkspace(project));
            }
        }
    }

    private async touch() {
        this.onProjectUpdate.fire();
        await this.generateWorkspace();
    }

    async deleteFileFromXcodeProject(files: vscode.Uri[]) {
        if (!this.isAllowed()) {
            if (await isActivated()) {
                this.onProjectUpdate.fire();
                return;
            }
            return;
        }
        const projectFiles = this.projectCache.getProjects();
        const modifiedProjects = new Set<string>();
        try {
            for (const file of files) {
                const selectedProject = await this.determineProjectFile(file.fsPath, projectFiles);

                for (const project of selectedProject) {
                    modifiedProjects.add(project);
                    try {
                        const list = this.projectCache.getList(project);
                        if (list.has(file.fsPath)) {
                            await deleteFileFromProject(
                                getFilePathInWorkspace(project),
                                file.fsPath
                            );
                        } else {
                            // folder
                            await deleteFolderFromProject(
                                getFilePathInWorkspace(project),
                                file.fsPath
                            );
                        }
                    } catch (err) {
                        console.log(err);
                    }
                }
            }
        } finally {
            for (const project of modifiedProjects) {
                await saveProject(getFilePathInWorkspace(project));
            }
        }
    }

    async getProjects() {
        return getProjectFiles(await getProjectPath());
    }

    async getProjectTargets() {
        const schemeType = getProjectType(await getProjectFileName());
        if (schemeType === "-package") {
            return await getTargets(await getProjectFileName(), getWorkspacePath());
        } else {
            for (const proj of await this.getProjects()) {
                return await getProjectTargets(getFilePathInWorkspace(proj));
            }
            return [];
        }
    }

    async getFilesForTarget(targetName: string) {
        const schemeType = getProjectType(await getProjectFileName());
        if (schemeType === "-package") {
            const path = targetName.endsWith("Tests") ? "Tests" : `Sources`;
            return (await vscode.workspace.findFiles(`${path}/${targetName}/**/*.swift`)).map(e => {
                return e.fsPath;
            });
        }
        for (const proj of await this.getProjects()) {
            return await listFilesFromTarget(getFilePathInWorkspace(proj), targetName);
        }
        return [];
    }

    async editFileTargets(file: vscode.Uri | undefined) {
        if (!this.isAllowed()) {
            return;
        }
        if (!file) {
            return;
        }
        const projectFiles = this.projectCache.getProjects();
        const selectedProject = await this.determineProjectFile(file.fsPath, projectFiles);
        if (selectedProject.length !== 1) {
            return;
        }

        const fileTargets = await listTargetsForFile(
            getFilePathInWorkspace(selectedProject[0]),
            file.fsPath
        );
        const targets = await getProjectTargets(getFilePathInWorkspace(selectedProject[0]));
        const items: QuickPickItem[] = sortTargets(targets, fileTargets);
        let selectedTargets = await showPicker(
            items,
            "Edit targets of a file",
            "",
            true,
            false,
            false
        );

        if (selectedTargets === undefined) {
            return;
        }

        selectedTargets = selectedTargets.join(",");

        await updateFileToProject(
            getFilePathInWorkspace(selectedProject[0]),
            selectedTargets,
            file.fsPath
        );
        await saveProject(getFilePathInWorkspace(selectedProject[0]));
    }

    async addAFileToXcodeProject(files: vscode.Uri | vscode.Uri[] | undefined) {
        if (!this.isAllowed()) {
            if (await isActivated()) {
                this.onProjectUpdate.fire();
                return;
            }
            return;
        }
        if (files === undefined) {
            return;
        }
        let fileList: vscode.Uri[] = [];
        if (files instanceof vscode.Uri) {
            fileList = [files as vscode.Uri];
        } else {
            fileList = files as vscode.Uri[];
            if (fileList.length === 0) {
                return;
            }
        }

        const projectFiles = this.projectCache.getProjects();
        const selectedProject: string | undefined = await this.selectBestFitProject(
            "Select A Project File to Add a new Files",
            fileList[0],
            projectFiles
        );
        if (selectedProject === undefined) {
            return;
        }

        const paths = fileList.map(file => {
            return { path: file, isFolder: isFolder(file.fsPath) };
        });

        for (const path of paths) {
            if (path.isFolder) {
                // add all files in subfolders
                const files = await glob.glob("**", {
                    absolute: true,
                    cwd: path.path.fsPath,
                    dot: true,
                    nodir: false,
                    ignore: "**/{.git,.svn,.hg,CVS,.DS_Store,Thumbs.db,.gitkeep,.gitignore}",
                });
                for (const file of files) {
                    if (file !== path.path.fsPath) {
                        paths.push({ path: vscode.Uri.file(file), isFolder: isFolder(file) });
                    }
                }
            }
        }

        const foldersToAdd = new Set<string>();
        const filesToAdd = new Set<string>();
        const allFilesInProject = this.projectCache.getList(selectedProject, false);
        for (const filePath of paths) {
            if (!filePath.isFolder) {
                const localFolder = filePath.path.fsPath
                    .split(path.sep)
                    .slice(0, -1)
                    .join(path.sep);
                if (!allFilesInProject.has(localFolder)) {
                    foldersToAdd.add(localFolder);
                }
                if (!allFilesInProject.has(filePath.path.fsPath)) {
                    filesToAdd.add(filePath.path.fsPath);
                }
            } else if (!allFilesInProject.has(filePath.path.fsPath)) {
                foldersToAdd.add(filePath.path.fsPath);
            }
        }
        if (filesToAdd.size === 0 && foldersToAdd.size === 0) {
            return;
        }

        let selectedTargets: string | undefined;
        if (filesToAdd.size > 0) {
            const proposedTargets = await this.determineTargetForFile(
                [...filesToAdd][0],
                selectedProject
            );
            const targets = await getProjectTargets(getFilePathInWorkspace(selectedProject));
            const items = sortTargets(targets, proposedTargets);
            const selectedTargetsArray = await showPicker(
                items,
                "Select Targets for The Files",
                "",
                true,
                true,
                false
            );
            if (selectedTargetsArray === undefined) {
                return;
            }
            selectedTargets = selectedTargetsArray.join(",");
        }

        for (const folder of foldersToAdd) {
            await addFolderToProject(getFilePathInWorkspace(selectedProject), folder);
        }

        for (const file of filesToAdd) {
            await addFileToProject(
                getFilePathInWorkspace(selectedProject),
                selectedTargets || "",
                file
            );
        }

        await saveProject(getFilePathInWorkspace(selectedProject));
    }

    private async selectBestFitProject(title: string, file: vscode.Uri, projectFiles: string[]) {
        const bestFitProject = await this.determineProjectFile(file.fsPath, projectFiles);
        let selectedProject: string | undefined;
        if (bestFitProject.length === 0) {
            selectedProject = await vscode.window.showQuickPick(projectFiles, {
                title: title,
                canPickMany: false,
                ignoreFocusOut: true,
            });
        } else {
            if (bestFitProject.length > 1) {
                selectedProject = await vscode.window.showQuickPick(bestFitProject, {
                    title: title,
                    canPickMany: false,
                    ignoreFocusOut: true,
                });
            } else {
                selectedProject = bestFitProject[0];
            }
        }
        return selectedProject;
    }

    private async determineTargetForFile(filePath: string, project: string) {
        const filePathComponent = filePath.split(path.sep);
        for (let i = filePathComponent.length - 1; i >= 0; --i) {
            const fileSubpath = filePathComponent.slice(0, i).join(path.sep);
            const neighborFiles = await vscode.workspace.findFiles({
                baseUri: vscode.Uri.file(fileSubpath),
                base: fileSubpath,
                pattern: "*",
            });
            for (const file of neighborFiles) {
                if (file.fsPath === filePath) {
                    continue;
                }
                const targets = await listTargetsForFile(
                    getFilePathInWorkspace(project),
                    file.fsPath
                );
                if (targets.length > 0) {
                    return targets;
                }
            }
        }
        return [];
    }

    private async determineProjectFile(filePath: string, projects: string[]) {
        const bestFitProject = new Set<string>();
        let largestCommonPrefix = -1;
        let relativeFileLength = Number.MAX_SAFE_INTEGER;
        const filePathComponent = filePath.split(path.sep);
        for (const project of projects) {
            await this.projectCache.update(project);
            const files = this.projectCache.getList(project, false);
            for (const file of files) {
                const fileComponent = file.split(path.sep);
                for (
                    let i = 0;
                    i < Math.min(fileComponent.length, filePathComponent.length) &&
                    fileComponent[i] === filePathComponent[i];
                    ++i
                ) {
                    if (i > largestCommonPrefix) {
                        largestCommonPrefix = i;
                        bestFitProject.clear();
                        bestFitProject.add(project);
                        relativeFileLength = file.length;
                    } else if (i === largestCommonPrefix) {
                        if (file.length < relativeFileLength) {
                            bestFitProject.clear();
                            relativeFileLength = file.length;
                            bestFitProject.add(project);
                        } else if (file.length === relativeFileLength) {
                            bestFitProject.add(project);
                        }
                    }
                }
            }
        }
        return [...bestFitProject];
    }
}

function sortTargets(targets: string[], fileTargets: string[]): QuickPickItem[] {
    return targets
        .map((target, index) => {
            return {
                label: target,
                value: target,
                picked: fileTargets.includes(target),
                index: index,
            };
        })
        .sort((a, b) => {
            if (a.picked !== b.picked) {
                return Number(b.picked) - Number(a.picked);
            }
            return a.index - b.index;
        });
}

export async function getProjectFiles(project: string) {
    if (project.indexOf(".xcworkspace") !== -1) {
        const xmlData = fs.readFileSync(path.join(project, "contents.xcworkspacedata"), "utf-8");

        const options = {
            ignoreAttributes: false,
            attributeNamePrefix: "",
        };
        const xml = new parser.XMLParser(options);
        const jsonObj = xml.parse(xmlData);
        console.log(jsonObj);
        const project_files: string[] = [];

        // eslint-disable-next-line no-inner-declarations, @typescript-eslint/no-explicit-any
        function findFileRefNodes(node: any, location: string) {
            if (node) {
                if (node.FileRef) {
                    let locationPath = location;
                    if (node.location) {
                        const localPath = getLocalPath(node);
                        locationPath = path.join(location, localPath);
                    }
                    const fileRefs = Array.isArray(node.FileRef) ? node.FileRef : [node.FileRef];
                    for (const ref of fileRefs) {
                        let location_ = ref.location;
                        location_ = location_.substring("group:".length);
                        if (location_.includes(".xcodeproj")) {
                            project_files.push(path.join(locationPath, location_));
                        }
                    }
                }
                for (const prop in node) {
                    if (node[prop] !== null && typeof node[prop] === "object") {
                        let locationPath = location;
                        if (node.location) {
                            const localPath = getLocalPath(node);
                            locationPath = path.join(location, localPath);
                        }
                        findFileRefNodes(node[prop], locationPath);
                    }
                }
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            function getLocalPath(node: any) {
                let localPath = node.location;
                if (node.location === "container:") {
                    localPath = node.location.substring("container:".length);
                } else if (node.location.substring(0, "group:".length) === "group:") {
                    localPath = node.location.substring("group:".length);
                }
                return localPath;
            }
        }
        findFileRefNodes(jsonObj, "");

        const projectFolder = await getProjectFolderPath();
        return project_files.map(p => {
            return path.join(projectFolder, p);
        });
    } else {
        return [path.relative(getWorkspacePath(), project)];
    }
}

/// Ruby scripts

const xcodeProjects = new Map<string, XcodeProjectFileProxy>();

async function executeRuby(projectPath: string, command: string): Promise<string[]> {
    if (!xcodeProjects.has(projectPath)) {
        xcodeProjects.set(projectPath, new XcodeProjectFileProxy(projectPath));
    }
    return (await xcodeProjects.get(projectPath)?.request(command)) || [];
}

async function getProjectTargets(projectFile: string) {
    return await executeRuby(projectFile, `list_targets`);
}

async function addFileToProject(projectFile: string, target: string, file: string) {
    return await executeRuby(projectFile, `add_file|^|^|${target}|^|^|${file}`);
}

async function addFolderToProject(projectFile: string, folder: string) {
    return await executeRuby(projectFile, `add_group|^|^|${folder}`);
}

async function updateFileToProject(projectFile: string, target: string, file: string) {
    return await executeRuby(projectFile, `update_file_targets|^|^|${target}|^|^|${file}`);
}

async function renameFileToProject(projectFile: string, oldFile: string, file: string) {
    return await executeRuby(projectFile, `rename_file|^|^|${oldFile}|^|^|${file}`);
}

async function moveFileToProject(projectFile: string, oldFile: string, file: string) {
    return await executeRuby(projectFile, `move_file|^|^|${oldFile}|^|^|${file}`);
}

async function renameFolderToProject(projectFile: string, oldFolder: string, newFolder: string) {
    return await executeRuby(projectFile, `rename_group|^|^|${oldFolder}|^|^|${newFolder}`);
}

async function moveFolderToProject(projectFile: string, oldFolder: string, newFolder: string) {
    return await executeRuby(projectFile, `move_group|^|^|${oldFolder}|^|^|${newFolder}`);
}

export async function listFilesFromProject(projectFile: string) {
    return await executeRuby(projectFile, `list_files|^|^|`);
}

export async function listFilesFromTarget(projectFile: string, targetName: string) {
    return await executeRuby(projectFile, `list_files_for_target|^|^|${targetName}`);
}

async function deleteFileFromProject(projectFile: string, file: string) {
    return await executeRuby(projectFile, `delete_file|^|^|${file}`);
}

async function deleteFolderFromProject(projectFile: string, folder: string) {
    return await executeRuby(projectFile, `delete_group|^|^|${folder}`);
}

async function listTargetsForFile(projectFile: string, file: string) {
    return await executeRuby(projectFile, `list_targets_for_file|^|^|${file}`);
}

async function saveProject(projectFile: string) {
    return await executeRuby(projectFile, "save");
}

/// helpers using xcodebuild as Package

function getProjectType(projectFile: string): string {
    if (projectFile.includes(".xcodeproj")) {
        return "-project";
    }
    if (projectFile.includes("Package.swift")) {
        return "-package";
    }
    return "-workspace";
}

async function getTargets(projectFile: string, cwd: string) {
    const command = ["xcodebuild", "-list"];
    const schemeType = getProjectType(projectFile);
    if (schemeType !== "-package") {
        command.push(schemeType);
        command.push(projectFile);
    }

    return new Promise<string[]>((resolve, reject) => {
        exec(command.join(" "), { encoding: "utf-8", cwd: cwd }, (error, stdout) => {
            if (error !== null) {
                reject(error);
                return;
            }
            const schemes: string[] = [];
            let isTail = false;

            for (const x of stdout.split("\n")) {
                if (isTail && x.trim().length > 0) {
                    schemes.push(x.trim());
                }

                if (x.includes("Schemes:")) {
                    isTail = true;
                }
            }
            resolve(schemes);
        });
    });
}
