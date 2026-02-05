import * as vscode from "vscode";
import * as fs from "fs";
import {
    getBuildRootPath,
    getFilePathInWorkspace,
    getFullProjectPath,
    getLogPath,
    getProjectFileName,
    getProjectFolderPath,
    getProjectPath,
    getWorkspaceId,
    getWorkspacePath,
    isActivated,
    isPackageSwiftProject,
    isProjectFileChanged,
} from "../env";
import * as parser from "fast-xml-parser";
import * as path from "path";
import { fileNameFromPath, isFileMoved, isFolder, readFileContent, sleep } from "../utils";
import { ProjectTree } from "./ProjectTree";
import { glob } from "glob";
import { ProjectCacheInterface, ProjectsCache } from "./ProjectsCache";
import { error } from "console";
import { QuickPickItem, showPicker } from "../inputPicker";
import { Mutex } from "async-mutex";
import { RubyProjectFilesManagerInterface } from "./RubyProjectFilesManager";
import { LogChannelInterface } from "../Logs/LogChannel";
import * as touch from "touch";
import {
    ProjectWatcherInterface,
    ProjectWatcherTouchInterface,
    watcherStabilityThreshold,
} from "./ProjectWatcher";

export interface ProjectManagerInterface {
    getRootProjectTargets(): Promise<string[]>;

    addBuildAllDependentTargetsOfProjects(
        rootTargetName: string,
        includeTargets: string[],
        shouldTouch: boolean
    ): Promise<{ scheme: string; path: string; projectPath: string } | undefined>;

    addTestSchemeDependOnTargetToProjects(
        projectFile: string,
        rootTargetName: string,
        testTargets: string | undefined,
        shouldTouch: boolean
    ): Promise<{ scheme: string; path: string; projectPath: string } | undefined>;
}

export interface TargetDependency {
    targetName: string;
    projectPath: string;
    id: string;
    files: Set<string>;
    dependencies: string[]; // list of target ids
}
export interface ProjectManagerProjectDependency {
    getTargetDependenciesGraph(): Promise<Map<string, TargetDependency>>;
}

export class ProjectManager
    implements ProjectManagerInterface, vscode.Disposable, ProjectManagerProjectDependency
{
    private disposable: vscode.Disposable[] = [];
    private projectWatcherDisposable: vscode.Disposable[] = [];

    private readonly projectFileEditMutex = new Mutex();

    readonly onProjectUpdate = new vscode.EventEmitter<void>();
    readonly onProjectLoaded = new vscode.EventEmitter<void>();
    onUpdateDeps: (() => Promise<void>) | undefined;
    private readonly projectCache: ProjectCacheInterface;

    private cachedTestTargets = new Map<string, string[]>();

    private isSavingProjects = false;

    constructor(
        private readonly log: LogChannelInterface,
        readonly projectWatcher: ProjectWatcherInterface & ProjectWatcherTouchInterface,
        private readonly rubyProjectFilesManager: RubyProjectFilesManagerInterface
    ) {
        this.projectCache = new ProjectsCache(projectWatcher, (projectFile: string) => {
            return this.rubyProjectFilesManager.listFilesFromProject(projectFile);
        });

        this.disposable.push(
            vscode.workspace.onDidCreateFiles(async e => {
                this.addAFileToXcodeProject([...e.files]);
                this.log.debug("Created a new files: " + e.files.map(f => f.fsPath).join(", "));
            })
        );

        this.disposable.push(
            vscode.workspace.onDidRenameFiles(e => {
                this.renameFileInXcodeProject(
                    e.files.map(f => {
                        return f.oldUri;
                    }),
                    e.files.map(f => {
                        return f.newUri;
                    })
                );
                this.log.debug(
                    "Renamed: " +
                        e.files.map(f => `${f.oldUri.fsPath} -> ${f.newUri.fsPath}`).join(", ")
                );
            })
        );

        this.disposable.push(
            vscode.workspace.onDidDeleteFiles(e => {
                this.deleteFileFromXcodeProject([...e.files]);
                this.log.debug("Deleted: " + e.files.map(f => f.fsPath).join(", "));
            })
        );

        fs.mkdirSync(getFilePathInWorkspace(this.cachePath()), { recursive: true });
    }

    resetProjectCache() {
        for (const dis of this.projectWatcherDisposable) {
            dis.dispose();
        }
        this.projectWatcherDisposable = [];
        this.projectCache.dispose();
        this.projectWatcher.dispose();
        this.cachedTestTargets.clear();
    }

    dispose() {
        for (const dis of this.disposable) {
            dis.dispose();
        }
        this.disposable = [];
        this.resetProjectCache();
    }

    private async addProject(projectPath: string) {
        if (await this.projectCache.addProject(projectPath)) {
            const watcher = this.projectWatcher.newFileWatcher(getFullProjectPath(projectPath));
            this.projectWatcherDisposable.push(
                watcher.onFileChanged(async () => {
                    if (!this.isSavingProjects) {
                        // notify only when we are not saving projects ourselves
                        await this.touch();
                    }
                })
            );
        }
    }

    async listTestTargetsForFile(file: string, project: string | undefined = undefined) {
        const release = await this.projectFileEditMutex.acquire();

        try {
            if (this.cachedTestTargets.has(file)) {
                return this.cachedTestTargets.get(file) || [];
            }
            const projects = project === undefined ? this.projectCache.getProjects() : [project];
            for (const project of projects) {
                const testTargets = await this.getTestProjectTargets(project);
                const targets = (
                    await this.rubyProjectFilesManager.listTargetsForFile(
                        getFilePathInWorkspace(project),
                        file
                    )
                ).filter(e => {
                    return e.length > 0 && testTargets.includes(e);
                });
                this.cachedTestTargets.set(file, targets);
                return targets;
            }
            return [];
        } finally {
            release();
        }
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
            this.resetProjectCache();
        } else {
            // try {
            //     await this.projectCache.preloadCacheFromFile(await this.xCodeCachePath());
            // } catch (err) {
            //     this.log.error(`Project files cache is broken ${err}`);
            // }
        }
        this.cachedTestTargets.clear();

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
                        await this.addProject(project);
                        await this.readAllProjects(await this.projectCache.getList(project, false));
                    } catch (error) {
                        this.log.error(`Failed to load project ${project}: ${error}`);
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
                "Open in Xcode",
                "Cancel"
            );
            if (option === "Update Dependencies" && this.onUpdateDeps !== undefined) {
                await this.onUpdateDeps();
                this.loadProjectFiles(shouldDropCache);
            } else if (option === "Open in Xcode") {
                vscode.commands.executeCommand("vscode-ios.env.open.xcode");
            }
        }
    }

    private async readAllProjects(files: Set<string>) {
        for (const file of files) {
            if (file.endsWith(".xcodeproj") || path.basename(file) === "Package.swift") {
                const relativeProjectPath = path.relative(getWorkspacePath(), file);
                await this.addProject(relativeProjectPath);
                if (
                    await isProjectFileChanged(
                        relativeProjectPath,
                        "ProjectsCache.readAllProjects",
                        this.projectWatcher
                    )
                ) {
                    await this.readAllProjects(
                        await this.projectCache.getList(relativeProjectPath, false)
                    );
                }
            }
        }
    }

    private async generateWorkspace() {
        const projectTree = new ProjectTree();

        projectTree.addIncluded(getFilePathInWorkspace((await getRootProjectFilePath()) || ""));
        projectTree.addIncluded(getFilePathInWorkspace(".vscode"));
        projectTree.addIncluded(getLogPath());
        projectTree.addIncluded(getFilePathInWorkspace("Package.swift"));

        // add all project first as they are visible
        const workspacePath = getWorkspacePath() + "/";
        for (const file of await this.projectCache.allFiles()) {
            // we don't want to include all root workspace files as they should be included via projects. Sometimes package.swift can be out of projects which causing issues
            if (file.includeSubfolders && workspacePath.startsWith(file.path + path.sep)) {
                continue;
            }
            projectTree.addIncluded(file.path, file.includeSubfolders);
        }
        for (const file of [...(await this.getAdditionalIncludedFiles())]) {
            // this.log.debug("Including file: " + file);
            projectTree.addIncluded(file, false);
        }

        // now try to go over all subfolder and exclude every single file which is not in the project files
        const visitedFolders = new Set<string>();
        for (const file of [
            getWorkspacePath(),
            ...(await this.projectCache.allFiles()).map(f => f.path),
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
                        const excludedFiles = await glob("*", {
                            absolute: true,
                            cwd: path.join(getWorkspacePath(), compPath),
                            dot: true,
                            nodir: false,
                            ignore: "**/{.git,.svn,.hg,CVS,.DS_Store,Thumbs.db,.gitkeep,.gitignore}",
                        });
                        for (const excludeFile of excludedFiles) {
                            projectTree.addExcluded(excludeFile);
                            // this.log.debug("Excluding file: " + excludeFile);
                        }
                    } catch (err) {
                        this.log.error(`Glob pattern is configured wrong: ${err}`);
                    }
                }
            }
        }

        // Generate json and dump to files
        const excludedFiles = projectTree.excludedFiles();
        // fifo files should be excluded
        excludedFiles.push(getFilePathInWorkspace(".vscode/xcode/fifo"));
        excludedFiles.push(getFilePathInWorkspace(".vscode/xcode/bundles"));
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
                "swift.disableSwiftPackageManagerIntegration": true,
                "swift.searchSubfoldersForPackages": false,
                // "swift.sourcekit-lsp.supported-languages": [], // cause throwing activation error event which is not good, simply disable lsp should be enough
                "swift.sourcekit-lsp.backgroundIndexing": "off",
                "lldb-dap.serverMode": true, // use server mode for lldb-dap to improve performance on running tests and debugging multiple sessions
                "lldb-dap.connectionTimeout": 3600, // set it to 60 minutes to allow long running debug sessions
            },
            extensions: {
                // tell vs code not to recommend it as it interfere with this extension
                unwantedRecommendations: ["sswg.swift-lang", "swiftlang.swift-vscode"],
            },
            launch: {
                configurations: [
                    {
                        type: "xcode-lldb",
                        name: "Xcode Workspace: Run App & Debug",
                        request: "launch",
                        target: "app",
                        isDebuggable: true,
                        buildBeforeLaunch: "always",
                        lldbCommands: [],
                    },
                ],
            },
        };
        const buildRootPath = await getBuildRootPath();
        if (buildRootPath !== undefined) {
            xCodeWorkspace.folders.push({
                name: "Dependencies",
                path: path.join(buildRootPath, "SourcePackages", "checkouts"),
            });
        }

        // await this.projectCache.saveCacheToFile(await this.xCodeCachePath());
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
            this.log.error(`Failed to get additional included files: ${String(err)}`);
            return new Set<string>();
        }
    }

    private async saveWorkspace(workspace: unknown) {
        const json = JSON.stringify(workspace, null, 4);
        return new Promise<void>(async (resolve, reject) => {
            fs.writeFile(await this.xCodeWorkspacePath(), json, async e => {
                this.log.error(`Save workspace error: ${String(e)}`);
                try {
                    if (e === null) {
                        if (
                            vscode.workspace.workspaceFile?.fsPath !==
                            (await this.xCodeWorkspacePath())
                        ) {
                            await this.openXCodeWorkspace(await this.xCodeWorkspacePath());
                            reject(Error("Opening in Workspace")); // xcode workspace is reloading, reject further execution
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

    private async renameFileInXcodeProject(oldFiles: vscode.Uri[], files: vscode.Uri[]) {
        if (!this.isAllowed()) {
            if (await isActivated()) {
                this.onProjectUpdate.fire();
                return;
            }
            return;
        }

        const modifiedProjects = new Set<string>();
        const release = await this.projectFileEditMutex.acquire();
        // adding algorithm works by grouping files by projects and then adding them one by one, so we need to collect all files which needs to be added during move operation
        const filesToAdd = [] as vscode.Uri[];
        try {
            const projectFiles = this.projectCache.getProjects();
            const prevChoices = new Map<string, string>(); // cache previous choices to not ask user multiple times for files which determines for the same project
            for (let i = 0; i < oldFiles.length; ++i) {
                const file = files[i];
                const oldFile = oldFiles[i];
                const newProject = await this.selectBestFitProject(
                    `'${oldFile}' was moved. Can not determine automatically new Project. Please select a project to move the file to.`,
                    file,
                    projectFiles,
                    prevChoices
                );
                const oldProjects = await this.determineProjectFile(oldFile.fsPath, projectFiles);

                // for the case when file was moved from one project to another, we need to remove it for the old project and add to the new one
                let isMovingBetweenProjects = false;
                for (const project of oldProjects) {
                    if (newProject !== project) {
                        if (newProject !== undefined) {
                            filesToAdd.push(file);
                        }

                        const delModified = await this.deleteFileFromXcodeProjectImp([oldFile]);
                        for (const project of delModified) {
                            modifiedProjects.add(project);
                        }
                        isMovingBetweenProjects = true;
                        break;
                    }
                }
                if (isMovingBetweenProjects || newProject === undefined) {
                    continue;
                }

                try {
                    modifiedProjects.add(newProject);
                    if (isFolder(file.fsPath)) {
                        // rename folder
                        if (isFileMoved(oldFile.fsPath, file.fsPath)) {
                            await this.rubyProjectFilesManager.moveFolderToProject(
                                getFilePathInWorkspace(newProject),
                                oldFile.fsPath,
                                file.fsPath
                            );
                        } else {
                            await this.rubyProjectFilesManager.renameFolderToProject(
                                getFilePathInWorkspace(newProject),
                                oldFile.fsPath,
                                file.fsPath
                            );
                        }
                    } else {
                        if (isFileMoved(oldFile.fsPath, file.fsPath)) {
                            await this.rubyProjectFilesManager.moveFileToProject(
                                getFilePathInWorkspace(newProject),
                                oldFile.fsPath,
                                file.fsPath
                            );
                        } else {
                            await this.rubyProjectFilesManager.renameFileToProject(
                                getFilePathInWorkspace(newProject),
                                oldFile.fsPath,
                                file.fsPath
                            );
                        }
                    }
                } catch (err) {
                    this.log.error(`Failed to rename file in project: ${String(err)}`);
                }
            }
            // now add files which were moved between projects
            try {
                const addModified = await this.addAFileToXcodeProjectImp(filesToAdd, prevChoices);
                for (const project of addModified) {
                    modifiedProjects.add(project);
                }
            } catch (err) {
                this.log.error(`Failed to add moved files to new project: ${String(err)}`);
            }
        } finally {
            await this.saveProjects(modifiedProjects);
            release();
        }
    }

    private async touch() {
        this.cachedTestTargets.clear();
        await this.generateWorkspace();
        this.onProjectUpdate.fire();
    }

    private async deleteFileFromXcodeProjectImp(files: vscode.Uri[]) {
        const projectFiles = this.projectCache.getProjects();
        const modifiedProjects = new Set<string>();
        for (const file of files) {
            const selectedProject = await this.determineProjectFile(file.fsPath, projectFiles);

            for (const project of selectedProject) {
                modifiedProjects.add(project);
                try {
                    const list = await this.projectCache.getList(project, true);
                    if (list.has(file.fsPath)) {
                        await this.rubyProjectFilesManager.deleteFileFromProject(
                            getFilePathInWorkspace(project),
                            file.fsPath
                        );
                    } else {
                        // folder
                        await this.rubyProjectFilesManager.deleteFolderFromProject(
                            getFilePathInWorkspace(project),
                            file.fsPath
                        );
                    }
                } catch (err) {
                    this.log.error(`Failed to delete file from project: ${String(err)}`);
                }
            }
        }
        return modifiedProjects;
    }

    async deleteFileFromXcodeProject(files: vscode.Uri[]) {
        if (!this.isAllowed()) {
            if (await isActivated()) {
                this.onProjectUpdate.fire();
                return;
            }
            return;
        }
        const release = await this.projectFileEditMutex.acquire();
        try {
            const modifiedProjects = await this.deleteFileFromXcodeProjectImp(files);
            await this.saveProjects(modifiedProjects);
        } finally {
            release();
        }
    }

    async getProjects() {
        return this.projectCache.getProjects();
    }

    async getRootProjectTargets() {
        const rootProjectFile = await getRootProjectFilePath();
        if (rootProjectFile === undefined) {
            return [];
        }
        return this.getProjectTargets(rootProjectFile);
    }

    // project is a related path to workspace
    async getProjectTargets(project: string) {
        return await this.rubyProjectFilesManager.getProjectTargets(
            getFilePathInWorkspace(project)
        );
    }

    async getTestProjectTargets(project: string) {
        return await this.rubyProjectFilesManager.getProjectTestsTargets(
            getFilePathInWorkspace(project)
        );
    }

    async getFilesForTarget(project: string, targetName: string) {
        return await this.rubyProjectFilesManager.listFilesFromTarget(
            getFilePathInWorkspace(project),
            targetName
        );
    }

    async editFileTargets(file: vscode.Uri | undefined) {
        if (!this.isAllowed()) {
            return;
        }
        if (!file) {
            return;
        }
        const release = await this.projectFileEditMutex.acquire();
        try {
            let selectedProject = await this.getProjectForFile(file.fsPath);
            if (selectedProject === undefined) {
                const candidates = await this.determineProjectFile(
                    file.fsPath,
                    this.projectCache.getProjects()
                );
                if (candidates.length !== 1) {
                    vscode.window.showInformationMessage(
                        "This file does not belong to any project in the workspace."
                    );
                    return;
                }
                selectedProject = candidates[0];
            }
            const selectedProjectPath = getFilePathInWorkspace(selectedProject);

            // for Package.swift a file can belong only to one target which is defined by file path
            if (path.basename(selectedProjectPath) === "Package.swift") {
                const target = await this.rubyProjectFilesManager.listTargetsForFile(
                    selectedProjectPath,
                    file.fsPath
                );
                if (target.length === 0) {
                    vscode.window.showInformationMessage(
                        "This file does not belong to any target in the Package.swift project."
                    );
                    return;
                }
                const items = sortTargets(target, target);
                await showPicker(items, "Package: File Target", "", false, false, false);
                return;
            }

            const typeOfPath =
                (
                    await this.rubyProjectFilesManager.typeOfPath(selectedProjectPath, file.fsPath)
                ).at(-1) ?? `file:${file.fsPath}`;

            const fileTargets = await this.rubyProjectFilesManager.listTargetsForFile(
                selectedProjectPath,
                file.fsPath
            );
            const targets =
                await this.rubyProjectFilesManager.getProjectTargets(selectedProjectPath);
            const items: QuickPickItem[] = sortTargets(targets, fileTargets);
            let message = `Edit targets of\n${path.relative(selectedProjectPath, file.fsPath)}`;
            if (typeOfPath.startsWith("folder:")) {
                message = `This file belongs to a folder. Edit targets of the folder and all its contents:\n${path.relative(selectedProjectPath, typeOfPath.substring("folder:".length))}`;
            }
            if (typeOfPath.startsWith("group:")) {
                vscode.window.showInformationMessage(
                    "This's an Xcode group. Please edit targets for individual files."
                );
                return;
            }
            let selectedTargets = await showPicker(items, message, "", true, false, false);

            if (selectedTargets === undefined) {
                return;
            }

            selectedTargets = selectedTargets.join(",");

            if (typeOfPath.startsWith("folder:")) {
                await this.rubyProjectFilesManager.updateFolderToProject(
                    selectedProjectPath,
                    selectedTargets,
                    typeOfPath.substring("folder:".length)
                );
            } else {
                await this.rubyProjectFilesManager.updateFileToProject(
                    selectedProjectPath,
                    selectedTargets,
                    file.fsPath
                );
            }
            await this.rubyProjectFilesManager.saveProject(selectedProjectPath);
        } finally {
            release();
        }
    }

    private async addAFileToXcodeProjectImp(
        files: vscode.Uri | vscode.Uri[] | undefined,
        prevChoices: Map<string, string> = new Map<string, string>()
    ) {
        if (files === undefined) {
            return new Set<string>();
        }
        let fileList: vscode.Uri[] = [];
        if (files instanceof vscode.Uri) {
            fileList = [files as vscode.Uri];
        } else {
            fileList = files as vscode.Uri[];
            if (fileList.length === 0) {
                return new Set<string>();
            }
        }

        const projectFiles = this.projectCache.getProjects();
        if (projectFiles.length === 0) {
            throw new Error(
                "No project files found to add a new file. Please wait until projects are loaded."
            );
        }
        const selectedProject: string | undefined = await this.selectBestFitProject(
            "Select A Project File to Add a new Files",
            fileList[0],
            projectFiles,
            prevChoices
        );
        if (selectedProject === undefined) {
            return new Set<string>();
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
                        paths.push({
                            path: vscode.Uri.file(file),
                            isFolder: isFolder(file),
                        });
                    }
                }
            }
        }

        const foldersToAdd = new Set<string>();
        const filesToAdd = new Set<string>();
        const allFilesInProject = await this.projectCache.getList(selectedProject, false);
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
            return new Set<string>();
        }

        let selectedTargets: string | undefined;
        let shouldAskForTargets = false;
        for (const file of filesToAdd) {
            const typeOfPath = (
                await this.rubyProjectFilesManager.typeOfPath(
                    getFilePathInWorkspace(selectedProject),
                    file
                )
            ).at(-1);
            if (typeOfPath !== undefined && typeOfPath.startsWith("file:")) {
                shouldAskForTargets = true;
                break;
            }
        }
        if (filesToAdd.size > 0 && shouldAskForTargets) {
            const proposedTargets = await this.determineTargetForFile(
                [...filesToAdd][0],
                selectedProject
            );
            const targets = await this.rubyProjectFilesManager.getProjectTargets(
                getFilePathInWorkspace(selectedProject)
            );
            const items = sortTargets(targets, proposedTargets);
            if (items.length > 1) {
                const selectedTargetsArray = await showPicker(
                    items,
                    `Adding to '${selectedProject}': Select Targets for The Files`,
                    "",
                    true,
                    true,
                    false
                );
                selectedTargets = selectedTargetsArray.join(",");
            } else {
                selectedTargets = items.map(i => i.value).join(",");
            }
        }

        for (const folder of foldersToAdd) {
            await this.rubyProjectFilesManager.addFolderToProject(
                getFilePathInWorkspace(selectedProject),
                folder
            );
        }

        for (const file of filesToAdd) {
            await this.rubyProjectFilesManager.addFileToProject(
                getFilePathInWorkspace(selectedProject),
                selectedTargets || "",
                file
            );
        }
        return new Set([selectedProject]);
    }

    async addAFileToXcodeProject(files: vscode.Uri | vscode.Uri[] | undefined) {
        if (!this.isAllowed()) {
            if (await isActivated()) {
                this.onProjectUpdate.fire();
                return;
            }
            return;
        }
        const release = await this.projectFileEditMutex.acquire();
        try {
            const modifiedProjects = await this.addAFileToXcodeProjectImp(files);
            await this.saveProjects(modifiedProjects);
        } finally {
            release();
        }
    }

    private async saveProjects(projects: Set<string>) {
        this.isSavingProjects = true;
        try {
            for (const project of projects) {
                try {
                    await this.rubyProjectFilesManager.saveProject(getFilePathInWorkspace(project));
                    if (isPackageSwiftProject(project)) {
                        await this.projectWatcher.update(getFilePathInWorkspace(project));
                    }
                } catch {
                    // ignore
                }
            }
            if (projects.size > 0) {
                await sleep(watcherStabilityThreshold + 120); // wait until file watchers are stable
                // notify about changes
                await this.touch();
            }
        } finally {
            this.isSavingProjects = false;
        }
    }

    private buildAllTargetTagCounter = 0;

    async cleanAutocompleteSchemes() {
        const release = await this.projectFileEditMutex.acquire();
        try {
            for (const project of this.projectCache.getProjects()) {
                const projectPath = (() => {
                    if (path.basename(project) === "Package.swift") {
                        return getFilePathInWorkspace(
                            path.join(path.dirname(project), ".swiftpm", "xcode")
                        );
                    }
                    return getFilePathInWorkspace(project);
                })();

                const schemeDir = path.join(
                    projectPath,
                    "xcuserdata",
                    `${process.env.USER}.xcuserdatad`,
                    "xcschemes"
                );

                if (fs.existsSync(schemeDir)) {
                    const globPattern = path.join(schemeDir, "VSCODE_AUTOCOMPLETE_TAG_*.xcscheme");
                    const files = await glob.glob(globPattern);
                    for (const file of files) {
                        fs.unlinkSync(file);
                    }
                }
            }
        } catch (err) {
            this.log.error(`Failed to clean autocomplete schemes: ${String(err)}`);
        } finally {
            release();
        }
    }

    async generateScheme(
        originalSchemeName: string,
        generate: (generatedSchemeName: string, originalSchemeName: string) => Promise<string[]>,
        shouldTouch: boolean = true
    ): Promise<{ scheme: string; path: string; projectPath: string } | undefined> {
        if (!this.isAllowed()) {
            if (await isActivated()) {
                this.onProjectUpdate.fire();
                return;
            }
            return;
        }
        const release = await this.projectFileEditMutex.acquire();
        try {
            this.buildAllTargetTagCounter += 1;
            const result = await generate(
                `VSCODE_AUTOCOMPLETE_TAG_${this.buildAllTargetTagCounter}`,
                originalSchemeName
            );
            if (
                result.length === 0 ||
                result.at(-1) === "scheme_does_not_exist" ||
                result.at(-1) === "scheme_unchanged"
            ) {
                throw new Error("Failed to add BuildAll target to the project");
            }

            const rootProjectPath = result.at(-2) || "";

            const touchProjectPath = (() => {
                if (path.basename(rootProjectPath) === "Package.swift") {
                    return rootProjectPath;
                }
                return path.join(rootProjectPath, "project.pbxproj");
            })();
            const schemePath = (() => {
                if (path.basename(rootProjectPath) === "Package.swift") {
                    return path.join(path.dirname(rootProjectPath), ".swiftpm", "xcode");
                }
                return rootProjectPath;
            })();
            if (shouldTouch) {
                touch.sync(touchProjectPath);
            }
            this.log.debug(
                `Generated scheme: VSCODE_AUTOCOMPLETE_TAG_${this.buildAllTargetTagCounter}, with added targets: ${result.join(", ")}`
            );
            return {
                scheme: result.at(-1) || "",
                path: path.join(
                    schemePath,
                    "xcuserdata",
                    `${process.env.USER}.xcuserdatad`,
                    "xcschemes",
                    `VSCODE_AUTOCOMPLETE_TAG_${this.buildAllTargetTagCounter}.xcscheme`
                ),
                projectPath: shouldTouch ? touchProjectPath : "",
            };
        } catch (err) {
            this.log.error(`Failed to generate Scheme target to projects: ${String(err)}`);
        } finally {
            release();
        }
    }

    async addBuildAllDependentTargetsOfProjects(
        rootTargetName: string,
        includeTargets: string[],
        shouldTouch: boolean
    ): Promise<{ scheme: string; path: string; projectPath: string } | undefined> {
        // root project should be the first one
        const all = [(await getRootProjectFilePath()) || "", ...this.projectCache.getProjects()];
        const projectFiles = [...new Set(all)].map(proj => getFilePathInWorkspace(proj));

        return this.generateScheme(
            rootTargetName,
            (schemeName: string, rootTargetName: string) =>
                this.rubyProjectFilesManager.generateSchemeDependOnTarget(
                    projectFiles,
                    schemeName,
                    rootTargetName,
                    includeTargets.join(",")
                ),
            shouldTouch
        );
    }

    async addTestSchemeDependOnTargetToProjects(
        projectFile: string,
        rootTargetName: string,
        testTargets: string | undefined,
        shouldTouch: boolean
    ): Promise<{ scheme: string; path: string; projectPath: string } | undefined> {
        return this.generateScheme(
            rootTargetName,
            (schemeName: string, rootTargetName: string) =>
                this.rubyProjectFilesManager.generateTestSchemeDependOnTarget(
                    getFilePathInWorkspace(projectFile),
                    schemeName,
                    rootTargetName,
                    testTargets
                ),
            shouldTouch
        );
    }

    private async selectBestFitProject(
        title: string,
        file: vscode.Uri,
        projectFiles: string[],
        prevChoices: Map<string, string> = new Map()
    ) {
        const bestFitProject = await this.determineProjectFile(file.fsPath, projectFiles);
        const key = JSON.stringify(bestFitProject);
        if (prevChoices.has(key)) {
            return prevChoices.get(key);
        }
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
        if (selectedProject !== undefined) {
            prevChoices.set(key, selectedProject);
        }
        return selectedProject;
    }

    private async determineTargetForFile(filePath: string, project: string) {
        const filePathComponent = filePath.split(path.sep);
        const neighborFiles = await this.projectCache.getList(project, true);
        let tryCnt = 0;
        for (let i = filePathComponent.length - 1; i >= 0; --i) {
            const fileSubpath = filePathComponent.slice(0, i).join(path.sep);
            for (const file of neighborFiles) {
                if (file.startsWith(`${fileSubpath}${path.sep}`) && file !== filePath) {
                    tryCnt += 1;
                    const targets = await this.rubyProjectFilesManager.listTargetsForFile(
                        getFilePathInWorkspace(project),
                        file
                    );
                    if (targets.length > 0) {
                        return targets;
                    }
                    if (tryCnt >= 20) {
                        // do not try too hard, let a user select manually if we can not find any
                        break;
                    }
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
            try {
                await this.addProject(project);
                const files = await this.projectCache.getList(project, false);
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
            } catch (err) {
                this.log.error(`Failed to update project cache for ${project}: ${err}`);
            }
        }
        return [...bestFitProject];
    }

    async getProjectForFile(filePath: string) {
        const projectFiles = this.projectCache.getProjects();
        for (const proj of projectFiles) {
            const files = await this.projectCache.getList(proj);
            if (files.has(filePath)) {
                return proj;
            }
        }
        return undefined;
    }

    async getTargetDependenciesGraph(): Promise<Map<string, TargetDependency>> {
        const graph = new Map<string, TargetDependency>();

        const projectsByTargetName = new Map<string, string[]>();

        const projectFiles = this.projectCache.getProjects();
        for (const project of projectFiles) {
            const projectPath = getFilePathInWorkspace(project);
            const targets = await this.rubyProjectFilesManager.getProjectTargets(projectPath);

            for (const target of targets) {
                const depTarget: TargetDependency = {
                    targetName: target,
                    projectPath: project,
                    id: `${getFilePathInWorkspace(project)}::${target}`,
                    files: new Set(
                        await this.rubyProjectFilesManager.listFilesFromTarget(
                            getFilePathInWorkspace(project),
                            target
                        )
                    ),
                    dependencies: [],
                };
                projectsByTargetName.set(target, [
                    ...(projectsByTargetName.get(target) || []),
                    project,
                ]);

                graph.set(depTarget.id, depTarget);
            }
        }

        // resolve dependencies
        for (const [, targetDep] of graph) {
            const dependencies = await this.rubyProjectFilesManager.listDependenciesForTarget(
                getFilePathInWorkspace(targetDep.projectPath),
                targetDep.targetName
            );
            for (const depTargetName of dependencies) {
                for (const project of projectsByTargetName.get(depTargetName) || []) {
                    // do not change the order of id, as it's parsed in project_helper.rb by splitting with "::"
                    const depTargetId = `${getFilePathInWorkspace(project)}::${depTargetName}`;
                    if (graph.has(depTargetId)) {
                        targetDep.dependencies.push(depTargetId);
                    }
                }
            }
        }

        return graph;
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

export async function getRootProjectFilePath() {
    const projects = await getProjectFiles(await getProjectPath());
    if (projects.length > 0) {
        return projects[0];
    }
    return undefined;
}

async function getProjectFiles(project: string) {
    if (project.indexOf(".xcworkspace") !== -1) {
        const xmlData = (
            await readFileContent(path.join(project, "contents.xcworkspacedata"))
        ).toString("utf-8");

        const options = {
            ignoreAttributes: false,
            attributeNamePrefix: "",
        };
        const xml = new parser.XMLParser(options);
        const jsonObj = xml.parse(xmlData);
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
