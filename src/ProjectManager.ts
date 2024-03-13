import * as vscode from "vscode";
import * as fs from 'fs';
import { getFilePathInWorkspace, getProjectFileName, getProjectFolderPath, getProjectPath, getScriptPath, getWorkspaceId, getWorkspacePath, isActivated } from "./env";
import * as parser from 'fast-xml-parser';
import { exec } from "child_process";
import path from "path";
import { fileNameFromPath, isFileMoved, isFolder } from "./utils";
import { ProjectTree } from "./ProjectTree";
import { glob } from 'glob';
import { ProjectsCache } from "./ProjectsCache";
import { error } from "console";
import { QuickPickItem, showPicker } from "./inputPicker";

export class ProjectManager {

    private disposable: vscode.Disposable[] = [];

    private projectCache = new ProjectsCache();

    onProjectUpdate = new vscode.EventEmitter<void>();
    onProjectLoaded = new vscode.EventEmitter<void>();

    constructor() {
        this.disposable.push(vscode.workspace.onDidCreateFiles(async e => {
            for (let uri of e.files) {
                if (!this.isAllowed()) {
                    return;
                }
                this.addAFileToXcodeProject(uri);
            }
            console.log("Create a new file");
        }));

        this.disposable.push(vscode.workspace.onDidRenameFiles(e => {
            for (let uri of e.files) {
                this.renameFile(uri.oldUri, uri.newUri);
            }
            console.log("Renamed");
        }));

        this.disposable.push(vscode.workspace.onDidDeleteFiles(e => {
            for (let uri of e.files) {
                this.deleteFileFromXcodeProject(uri);
            }
            console.log("Deleted");
        }));

        fs.mkdirSync(getFilePathInWorkspace(this.cachePath()), { recursive: true });

        this.loadProjectFiles();
    }

    async listTargetsForFile(file: string) {
        let schemeType = getProjectType(getProjectFileName());
        if (schemeType === "-package") {
            return await new Promise<string[]>(resolve => {
                let pathParts = file.split(path.sep);
                for (let i = pathParts.length - 1; i >= 0; --i) {
                    if (pathParts[i] == "Sources" || pathParts[i] == "Tests") {
                        resolve([pathParts[i + 1]]);
                        return;
                    }
                }
                resolve([]);
            });
        }
        const projects = this.projectCache.getProjects();
        for (let project of projects) {
            if (this.projectCache.getList(project).has(file)) {
                return (await listTargetsForFile(getFilePathInWorkspace(project), file))
                    .filter(e => { return e.length > 0; });
            }
        }
        return [];
    }

    async loadProjectFiles(shouldDropCache = false) {
        if (!this.isAllowed()) {
            return;
        }
        if (shouldDropCache) {
            this.projectCache.clear();
        } else {
            try {
                await this.projectCache.preloadCacheFromFile(this.xCodeCachePath());
            } catch (err) {
                console.log(`Project files cache is broken ${err}`);
            }
        }

        const projects = await getProjectFiles(getProjectPath());

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Loading Project" }, async (progress, token) => {
            for (let [index, project] of projects.entries()) {
                progress.report({ increment: 100 * index / (project.length + 1), message: fileNameFromPath(project) });
                await this.projectCache.update(project);
                await this.readAllProjects(this.projectCache.getList(project));
            }
            progress.report({ increment: 1, message: "Generating workspace..." });
            await this.generateWorkspace();
        });
    }

    private async readAllProjects(files: Set<string>) {
        for (let file of files) {
            if (file.endsWith(".xcodeproj")) {
                const relativeProjectPath = path.relative(getWorkspacePath(), file);
                if (!this.projectCache.has(relativeProjectPath)) {
                    await this.projectCache.update(relativeProjectPath);
                    await this.readAllProjects(this.projectCache.getList(relativeProjectPath));
                }
            }
        }
    }

    private async generateWorkspace() {
        const projectTree = new ProjectTree();

        // add all project first as they are visible
        for (let file of [...this.projectCache.files(), ...this.projectCache.files(true), ...await this.getAdditionalIncludedFiles()]) {
            projectTree.addIncluded(file);
        }
        projectTree.addIncluded(getFilePathInWorkspace(".vscode"));
        projectTree.addIncluded(getFilePathInWorkspace(".logs"));

        // now try to go over all subfolder and exclude every single file which is not in the project files 
        const visitedFolders = new Set<string>();
        for (let file of [getWorkspacePath(), ...this.projectCache.files()]) {
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
                    const files = await glob(
                        "*",
                        {
                            absolute: true,
                            cwd: path.join(getWorkspacePath(), compPath),
                            dot: true,
                            nodir: false,
                            ignore: "**/{.git,.svn,.hg,CVS,.DS_Store,Thumbs.db,.gitkeep,.gitignore}"
                        }
                    );
                    for (let file of files) {
                        projectTree.addExcluded(file);
                    }
                }
            }
        }

        // Generate json and dump to files
        const excludedFiles = projectTree.excludedFiles();
        let excludedFilesDict: { [key: string]: boolean } = {};
        for (let file of excludedFiles) {
            const relative = path.relative(getWorkspacePath(), file);
            excludedFilesDict[relative] = true;
        }
        const workspaceName = `${getWorkspacePath().split(path.sep).at(-1)}/${getProjectFileName()}`;
        const xCodeWorkspace =
        {
            folders: [
                {
                    name: workspaceName,
                    path: "../.."
                }
            ],
            settings: {
                "files.exclude": excludedFilesDict,
                "search.exclude": excludedFilesDict
            }
        }

        await this.projectCache.saveCacheToFile(this.xCodeCachePath());
        await this.saveWorkspace(xCodeWorkspace);
    }

    private async getAdditionalIncludedFiles() {
        try {
            const json = fs.readFileSync(
                path.join(
                    getWorkspacePath(),
                    `${getProjectFileName().split(".").slice(0, -1).join(".")}.files.json`)
                ,
                "utf-8"
            );

            const obj = JSON.parse(json);
            let resFiles = new Set<string>();

            for (let pattern of obj.files) {
                const cwd = path.join(getFilePathInWorkspace(getProjectFolderPath()), pattern.search.cwd);
                const files = await glob(
                    pattern.search.include,
                    {
                        absolute: true,
                        cwd: cwd,
                        dot: pattern.search.dot,
                        nodir: pattern.search.nodir,
                        ignore: pattern.search.ignore
                    }
                );
                for (let file of files)
                    resFiles.add(file);
            }

            return resFiles;
        } catch (err) {
            console.log(err);
            return new Set<string>();
        }
    }

    private async saveWorkspace(workspace: any) {
        const json = JSON.stringify(workspace, null, 4);
        return new Promise<void>(async (resolve, reject) => {
            fs.writeFile(this.xCodeWorkspacePath(), json, async e => {
                console.log(e);
                try {
                    if (e === null) {
                        if (vscode.workspace.workspaceFile?.fsPath !== this.xCodeWorkspacePath()) {
                            await this.openXCodeWorkspace(this.xCodeWorkspacePath());
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

    private xCodeCachePath() {
        return getFilePathInWorkspace(path.join(this.cachePath(), `${getWorkspaceId()}_projects.json`));
    }

    private xCodeWorkspacePath() {
        return getFilePathInWorkspace(path.join(this.cachePath(), `${getWorkspaceId()}.code-workspace`));
    }

    private async openXCodeWorkspace(file: string) {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(file));
    }

    private isAllowed() {
        if (!isActivated()) {
            return false;
        }
        if (getProjectFileName() == "Package.swift") {
            return false;
        }
        return true;
    }

    private async renameFile(oldFile: vscode.Uri, file: vscode.Uri) {
        if (!this.isAllowed()) {
            return;
        }

        const projectFiles = this.projectCache.getProjects();
        let selectedProject = await this.determineProjectFile(file.fsPath, projectFiles);

        for (let project of selectedProject) {
            try {
                if (isFolder(file.fsPath)) {
                    // rename folder
                    if (isFileMoved(oldFile.fsPath, file.fsPath))
                        await moveFolderToProject(getFilePathInWorkspace(project), oldFile.fsPath, file.fsPath);
                    else
                        await renameFolderToProject(getFilePathInWorkspace(project), oldFile.fsPath, file.fsPath);
                } else {
                    if (isFileMoved(oldFile.fsPath, file.fsPath))
                        await moveFileToProject(getFilePathInWorkspace(project), oldFile.fsPath, file.fsPath);
                    else
                        await renameFileToProject(getFilePathInWorkspace(project), oldFile.fsPath, file.fsPath);
                }
                this.touch();
            } catch (err) {
                console.log(err);
            }
        }
    }

    private async touch() {
        this.onProjectUpdate.fire();
    }

    private async deleteFileFromXcodeProject(file: vscode.Uri) {
        if (!this.isAllowed()) {
            return;
        }
        const projectFiles = this.projectCache.getProjects();
        let selectedProject = await this.determineProjectFile(file.fsPath, projectFiles);

        for (let project of selectedProject) {
            try {
                const list = this.projectCache.getList(project);
                if (list.has(file.fsPath)) {
                    await deleteFileFromProject(getFilePathInWorkspace(project), file.fsPath);
                } else { // folder
                    await deleteFolderFromProject(getFilePathInWorkspace(project), file.fsPath);
                }
                this.touch();
            } catch (err) {
                console.log(err);
            }
        }
    }

    async getProjects() {
        return await getProjectFiles(getProjectPath());
    }

    async getProjectTargets() {
        let schemeType = getProjectType(getProjectFileName());
        if (schemeType === "-package")
            return await getTargets(getProjectFileName(), getWorkspacePath());
        else {
            for (const proj of await this.getProjects()) {
                return await getProjectTargets(getFilePathInWorkspace(proj));
            }
            return [];
        }
    }

    async getFilesForTarget(targetName: string) {
        let schemeType = getProjectType(getProjectFileName());
        if (schemeType === "-package") {
            let path = targetName.endsWith("Tests") ? "Tests" : `Sources`;
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
        if (!file)
            return;
        const projectFiles = this.projectCache.getProjects();
        let selectedProject = await this.determineProjectFile(file.fsPath, projectFiles);
        if (selectedProject.length !== 1)
            return;

        const fileTargets = await listTargetsForFile(getFilePathInWorkspace(selectedProject[0]), file.fsPath);
        const targets = await getProjectTargets(getFilePathInWorkspace(selectedProject[0]));
        const items: QuickPickItem[] = targets.map(target => {
            return { label: target, value: target, picked: fileTargets.includes(target) };
        });
        const selectedTargets = await showPicker(items, "Edit targets of a file", "", true, false, false, ",");

        if (selectedTargets === undefined)
            return;

        await updateFileToProject(getFilePathInWorkspace(selectedProject[0]), selectedTargets, file.fsPath);
    }

    async addAFileToXcodeProject(files: vscode.Uri | vscode.Uri[] | undefined) {
        if (files === undefined) {
            return;
        }
        let fileList: vscode.Uri[] = [];
        if (files instanceof vscode.Uri) {
            fileList = [files as vscode.Uri];
        }
        else {
            fileList = files as vscode.Uri[];
            if (fileList.length == 0)
                return;
        }

        const projectFiles = this.projectCache.getProjects();
        let selectedProject: string | undefined = await this.selectBestFitProject("Select A Project File to Add a new Files", fileList[0], projectFiles);
        if (selectedProject === undefined) {
            return;
        }

        if (isFolder(fileList[0].fsPath)) {
            // add Folder
            // TODO: Add all content in the folder to the project
            for (const folder of fileList) {
                await addFolderToProject(getFilePathInWorkspace(selectedProject), folder.fsPath);
            }
        } else {
            const targets = await getProjectTargets(getFilePathInWorkspace(selectedProject));
            const selectedTarget = await vscode.window.showQuickPick(targets, { canPickMany: true, ignoreFocusOut: true, title: "Select Targets for The Files" });
            if (selectedTarget === undefined) {
                return;
            }

            for (const file of fileList) {
                await addFileToProject(
                    getFilePathInWorkspace(selectedProject),
                    selectedTarget.join(","),
                    file.fsPath
                );
            }
            if (selectedTarget.length > 0)
                this.touch();
        }
    }

    private async selectBestFitProject(title: string, file: vscode.Uri, projectFiles: string[]) {
        const bestFitProject = await this.determineProjectFile(file.fsPath, projectFiles);
        let selectedProject: string | undefined;
        if (bestFitProject.length == 0) {
            selectedProject = await vscode.window.showQuickPick(projectFiles, { title: title, canPickMany: false, ignoreFocusOut: true });
        } else {
            if (bestFitProject.length > 1)
                selectedProject = await vscode.window.showQuickPick(bestFitProject, { title: title, canPickMany: false, ignoreFocusOut: true });

            else
                selectedProject = bestFitProject[0];
        }
        return selectedProject;
    }

    private async determineProjectFile(filePath: string, projects: string[]) {
        let bestFitProject = new Set<string>();
        let largestCommonPrefix = -1;
        let relativeFileLength = Number.MAX_SAFE_INTEGER;
        const filePathComponent = filePath.split(path.sep);
        for (const project of projects) {
            await this.projectCache.update(project);
            const files = this.projectCache.getList(project, false);
            for (const file of files) {
                const fileComponent = file.split(path.sep);
                for (let i = 0; i < Math.min(fileComponent.length, filePathComponent.length) && fileComponent[i] === filePathComponent[i]; ++i) {
                    if (i > largestCommonPrefix) {
                        largestCommonPrefix = i;
                        bestFitProject.clear();
                        bestFitProject.add(project);
                        relativeFileLength = file.length;
                    } else if (i == largestCommonPrefix) {
                        if (file.length < relativeFileLength) {
                            bestFitProject.clear();
                            relativeFileLength = file.length;
                            bestFitProject.add(project);
                        } else if (file.length == relativeFileLength)
                            bestFitProject.add(project);
                    }
                }
            }
        }
        return [...bestFitProject];
    }
}

function getProjectFiles(project: string) {
    if (project.indexOf(".xcworkspace") !== -1) {
        let xmlData = fs.readFileSync(path.join(project, "contents.xcworkspacedata"), 'utf-8');

        const options = {
            ignoreAttributes: false,
            attributeNamePrefix: ''
        };
        const xml = new parser.XMLParser(options);
        let jsonObj = xml.parse(xmlData);
        console.log(jsonObj);
        let project_files: string[] = [];

        function findFileRefNodes(node: any, location: string) {
            if (node) {
                if (node.FileRef) {
                    let locationPath = location;
                    if (node.location) {
                        locationPath = path.join(location, node.location.substring('group:'.length));
                    }
                    let fileRefs = Array.isArray(node.FileRef) ? node.FileRef : [node.FileRef];
                    for (let ref of fileRefs) {
                        let location_ = ref.location;
                        location_ = location_.substring('group:'.length);
                        if (location_.includes('.xcodeproj')) {
                            project_files.push(path.join(locationPath, location_));
                        }
                    }
                }
                for (let prop in node) {
                    if (node[prop] !== null && typeof (node[prop]) === 'object') {
                        let locationPath = location;
                        if (node.location) {
                            locationPath = path.join(location, node.location.substring('group:'.length));
                        }
                        findFileRefNodes(node[prop], locationPath);
                    }
                }
            }
        }
        findFileRefNodes(jsonObj, "");

        return project_files.map(p => {
            return path.join(getProjectFolderPath(), p);
        });
    } else {
        return [path.relative(getWorkspacePath(), project)];
    }
}

/// Ruby scripts

async function executeRuby(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const str = exec(
            `ruby '${getScriptPath("project_helper.rb")}'  ${command}`,
            { maxBuffer: 1024 * 1024 * 1024 },
            (error, stdout) => {
                if (error !== null) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            }
        );
    });
}

async function getProjectTargets(projectFile: string) {
    const stdout = await executeRuby(`list_targets '${projectFile}'`);
    return stdout.split("\n").filter(e => {
        return e.length > 0;
    });
}

async function addFileToProject(projectFile: string, target: string, file: string) {
    return await executeRuby(`add_file '${projectFile}' '${target}' '${file}'`)
}

async function addFolderToProject(projectFile: string, folder: string) {
    return await executeRuby(`add_group '${projectFile}' '${folder}'`)
}

async function updateFileToProject(projectFile: string, target: string, file: string) {
    return await executeRuby(`update_file_targets '${projectFile}' '${target}' '${file}'`)
}

async function renameFileToProject(projectFile: string, oldFile: string, file: string) {
    return executeRuby(`rename_file '${projectFile}' '${oldFile}' '${file}'`);
}

async function moveFileToProject(projectFile: string, oldFile: string, file: string) {
    return executeRuby(`move_file '${projectFile}' '${oldFile}' '${file}'`);
}

async function renameFolderToProject(projectFile: string, oldFolder: string, newFolder: string) {
    return executeRuby(`rename_group '${projectFile}' '${oldFolder}' '${newFolder}'`);
}

async function moveFolderToProject(projectFile: string, oldFolder: string, newFolder: string) {
    return executeRuby(`move_group '${projectFile}' '${oldFolder}' '${newFolder}'`);
}

export async function listFilesFromProject(projectFile: string) {
    const stdout = await executeRuby(`list_files '${projectFile}'`);
    return stdout.split("\n").filter(e => {
        return e.length > 0;
    });
}

export async function listFilesFromTarget(projectFile: string, targetName: String) {
    const stdout = await executeRuby(`list_files_for_target '${projectFile}' '${targetName}'`);
    return stdout.split("\n");
}


async function deleteFileFromProject(projectFile: string, file: string) {
    return executeRuby(`delete_file '${projectFile}' '${file}'`);
}

async function deleteFolderFromProject(projectFile: string, folder: string) {
    return executeRuby(`delete_group '${projectFile}' '${folder}'`);
}

async function listTargetsForFile(projectFile: string, file: string) {
    const stdout = await executeRuby(`list_targets_for_file '${projectFile}' '${file}'`);
    return stdout.split("\n").filter(e => {
        return e.length > 0;
    });
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
    let command = ["xcodebuild", "-list"];
    let schemeType = getProjectType(projectFile);
    if (schemeType != "-package") {
        command.push(schemeType);
        command.push(projectFile);
    }

    return new Promise<string[]>((resolve, reject) => {
        exec(command.join(' '), { encoding: "utf-8", cwd: cwd }, (error, stdout) => {
            if (error !== null) {
                reject(error);
                return;
            }
            let schemes: string[] = [];
            let isTail = false;

            for (let x of stdout.split('\n')) {
                if (isTail && x.trim().length > 0)
                    schemes.push(x.trim());

                if (x.includes("Schemes:"))
                    isTail = true;
            }
            resolve(schemes);
        });
    });
}