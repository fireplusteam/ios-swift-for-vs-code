import * as vscode from "vscode";
import * as fs from "fs";
import {
    getBuildRootPath,
    getFilePathInWorkspace,
    getLogPath,
    getProjectFileName,
    getProjectFolderPath,
    getProjectPath,
    getWorkspaceId,
    getWorkspacePath,
    isActivated,
} from "../env";
import * as parser from "fast-xml-parser";
import * as path from "path";
import { fileNameFromPath, isFileMoved, isFolder } from "../utils";
import { ProjectTree } from "./ProjectTree";
import { glob } from "glob";
import { ProjectCacheInterface, ProjectsCache } from "./ProjectsCache";
import { error } from "console";
import { QuickPickItem, showPicker } from "../inputPicker";
import { Mutex } from "async-mutex";
import { RubyProjectFilesManagerInterface } from "./RubyProjectFilesManager";
import { LogChannelInterface } from "../Logs/LogChannel";
import * as touch from "touch";

export interface ProjectManagerInterface {
    getRootProjectTargets(): Promise<string[]>;

    addBuildAllTargetToProjects(
        rootTargetName: string,
        includeTargets: string[],
        excludeTargets: string[]
    ): Promise<{ scheme: string; path: string; projectPath: string } | undefined>;

    addTestSchemeDependOnTargetToProjects(
        rootTargetName: string,
        testTargets: string | undefined
    ): Promise<{ scheme: string; path: string; projectPath: string } | undefined>;
}

export class ProjectManager implements ProjectManagerInterface {
    private readonly disposable: vscode.Disposable[] = [];

    private readonly projectFileEditMutex = new Mutex();

    readonly onProjectUpdate = new vscode.EventEmitter<void>();
    readonly onProjectLoaded = new vscode.EventEmitter<void>();
    onUpdateDeps: (() => Promise<void>) | undefined;

    private cachedTestTargets = new Map<string, string[]>();

    constructor(
        private readonly log: LogChannelInterface,
        private readonly rubyProjectFilesManager: RubyProjectFilesManagerInterface,
        private readonly projectCache: ProjectCacheInterface = new ProjectsCache()
    ) {
        this.disposable.push(
            vscode.workspace.onDidCreateFiles(async e => {
                this.addAFileToXcodeProject([...e.files]);
                this.log.debug("Created a new files: " + e.files.map(f => f.fsPath).join(", "));
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
        this.disposable.push(
            this.projectCache.onProjectChanged.event(() => {
                this.touch();
            })
        );

        fs.mkdirSync(getFilePathInWorkspace(this.cachePath()), { recursive: true });
    }

    isTestTarget(target: string) {
        return target.toLowerCase().includes("tests");
    }

    async listTestTargetsForFile(file: string, project: string | undefined = undefined) {
        const release = await this.projectFileEditMutex.acquire();

        try {
            if (this.cachedTestTargets.has(file)) {
                return this.cachedTestTargets.get(file) || [];
            }
            const projects = project === undefined ? this.projectCache.getProjects() : [project];
            for (const project of projects) {
                const targets = (
                    await this.rubyProjectFilesManager.listTargetsForFile(
                        getFilePathInWorkspace(project),
                        file
                    )
                ).filter(e => {
                    return e.length > 0 && this.isTestTarget(e);
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
            this.projectCache.clear();
        } else {
            try {
                await this.projectCache.preloadCacheFromFile(await this.xCodeCachePath());
            } catch (err) {
                this.log.error(`Project files cache is broken ${err}`);
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
                        await this.projectCache.update(project, projectFile => {
                            return this.rubyProjectFilesManager.listFilesFromProject(projectFile);
                        });
                        await this.readAllProjects(this.projectCache.getList(project, false));
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
            if (file.endsWith(".xcodeproj")) {
                const relativeProjectPath = path.relative(getWorkspacePath(), file);
                if (
                    await this.projectCache.update(relativeProjectPath, projectFile => {
                        return this.rubyProjectFilesManager.listFilesFromProject(projectFile);
                    })
                ) {
                    await this.readAllProjects(
                        this.projectCache.getList(relativeProjectPath, false)
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

        // add all project first as they are visible
        for (const file of this.projectCache.allFiles()) {
            projectTree.addIncluded(file.path, file.includeSubfolders);
        }
        for (const file of [...(await this.getAdditionalIncludedFiles())]) {
            // this.log.debug("Including file: " + file);
            projectTree.addIncluded(file, false);
        }

        // now try to go over all subfolder and exclude every single file which is not in the project files
        const visitedFolders = new Set<string>();
        for (const file of [getWorkspacePath(), ...this.projectCache.allFiles().map(f => f.path)]) {
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
        };
        const buildRootPath = await getBuildRootPath();
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

    private async renameFile(oldFiles: vscode.Uri[], files: vscode.Uri[]) {
        if (!this.isAllowed()) {
            if (await isActivated()) {
                this.onProjectUpdate.fire();
                return;
            }
            return;
        }

        const release = await this.projectFileEditMutex.acquire();
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
                                await this.rubyProjectFilesManager.moveFolderToProject(
                                    getFilePathInWorkspace(project),
                                    oldFile.fsPath,
                                    file.fsPath
                                );
                            } else {
                                await this.rubyProjectFilesManager.renameFolderToProject(
                                    getFilePathInWorkspace(project),
                                    oldFile.fsPath,
                                    file.fsPath
                                );
                            }
                        } else {
                            if (isFileMoved(oldFile.fsPath, file.fsPath)) {
                                await this.rubyProjectFilesManager.moveFileToProject(
                                    getFilePathInWorkspace(project),
                                    oldFile.fsPath,
                                    file.fsPath
                                );
                            } else {
                                await this.rubyProjectFilesManager.renameFileToProject(
                                    getFilePathInWorkspace(project),
                                    oldFile.fsPath,
                                    file.fsPath
                                );
                            }
                        }
                    } catch (err) {
                        this.log.error(`Failed to rename file in project: ${String(err)}`);
                    }
                }
            }
        } finally {
            try {
                for (const project of modifiedProjects) {
                    await this.rubyProjectFilesManager.saveProject(getFilePathInWorkspace(project));
                }
            } finally {
                release();
            }
        }
    }

    private async touch() {
        this.cachedTestTargets.clear();
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
        const release = await this.projectFileEditMutex.acquire();
        try {
            for (const file of files) {
                const selectedProject = await this.determineProjectFile(file.fsPath, projectFiles);

                for (const project of selectedProject) {
                    modifiedProjects.add(project);
                    try {
                        const list = this.projectCache.getList(project);
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
        } finally {
            try {
                for (const project of modifiedProjects) {
                    await this.rubyProjectFilesManager.saveProject(getFilePathInWorkspace(project));
                }
            } finally {
                release();
            }
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
        const release = await this.projectFileEditMutex.acquire();
        if (!file) {
            return;
        }
        try {
            const projectFiles = this.projectCache.getProjects();
            const selectedProject = await this.determineProjectFile(file.fsPath, projectFiles);
            if (selectedProject.length !== 1) {
                return;
            }
            const selectedProjectPath = getFilePathInWorkspace(selectedProject[0]);

            const typeOfPath =
                (
                    await this.rubyProjectFilesManager.typeOfPath(
                        getFilePathInWorkspace(selectedProject[0]),
                        file.fsPath
                    )
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

    async addAFileToXcodeProject(files: vscode.Uri | vscode.Uri[] | undefined) {
        const release = await this.projectFileEditMutex.acquire();
        try {
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
            if (projectFiles.length === 0) {
                throw new Error(
                    "No project files found to add a new file. Please wait until projects are loaded."
                );
            }
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

            await this.rubyProjectFilesManager.saveProject(getFilePathInWorkspace(selectedProject));
        } finally {
            release();
        }
    }

    private buildAllTargetTagCounter = 0;

    async cleanAutocompleteSchemes() {
        const release = await this.projectFileEditMutex.acquire();
        try {
            const rootProject = await getRootProjectFilePath();
            if (rootProject === undefined) {
                throw new Error("No project files found to clean autocomplete schemes");
            }
            const rootProjectPath = getFilePathInWorkspace(rootProject);

            const schemeDir = path.join(
                rootProjectPath,
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
        } catch (err) {
            this.log.error(`Failed to clean autocomplete schemes: ${String(err)}`);
        } finally {
            release();
        }
    }

    async generateScheme(
        originalSchemeName: string,
        generate: (
            rootProjectPath: string,
            generatedSchemeName: string,
            originalSchemeName: string
        ) => Promise<string[]>
    ): Promise<{ scheme: string; path: string; projectPath: string } | undefined> {
        const release = await this.projectFileEditMutex.acquire();
        try {
            if (!this.isAllowed()) {
                if (await isActivated()) {
                    this.onProjectUpdate.fire();
                    return;
                }
                return;
            }

            const rootProject = await getRootProjectFilePath();
            if (rootProject === undefined) {
                throw new Error("No project files found to add BuildAll target");
            }
            const rootProjectPath = getFilePathInWorkspace(rootProject);

            const projectFiles = this.projectCache.getProjects();
            for (const project of projectFiles) {
                if (project === rootProject) {
                    this.buildAllTargetTagCounter += 1;
                    const allScheme = await generate(
                        rootProjectPath,
                        `VSCODE_AUTOCOMPLETE_TAG_${this.buildAllTargetTagCounter}`,
                        originalSchemeName
                    );
                    if (
                        allScheme.length === 0 ||
                        allScheme.at(-1) === "scheme_does_not_exist" ||
                        allScheme.at(-1) === "scheme_unchanged"
                    ) {
                        throw new Error("Failed to add BuildAll target to the project");
                    }
                    const touchProjectPath = path.join(rootProjectPath, "project.pbxproj");
                    touch.sync(touchProjectPath);
                    this.log.debug(
                        `Generated scheme: VSCODE_AUTOCOMPLETE_TAG_${this.buildAllTargetTagCounter}, with added targets: ${allScheme.join(", ")}`
                    );
                    return {
                        scheme: allScheme.at(-1) || "",
                        path: path.join(
                            rootProjectPath,
                            "xcuserdata",
                            `${process.env.USER}.xcuserdatad`,
                            "xcschemes",
                            `VSCODE_AUTOCOMPLETE_TAG_${this.buildAllTargetTagCounter}.xcscheme`
                        ),
                        projectPath: touchProjectPath,
                    };
                }
            }
        } catch (err) {
            this.log.error(`Failed to generate Scheme target to projects: ${String(err)}`);
        } finally {
            release();
        }
    }

    async addBuildAllTargetToProjects(
        rootTargetName: string,
        includeTargets: string[],
        excludeTargets: string[]
    ): Promise<{ scheme: string; path: string; projectPath: string } | undefined> {
        return this.generateScheme(
            rootTargetName,
            (rootProjectPath: string, schemeName: string, rootTargetName: string) =>
                this.rubyProjectFilesManager.generateSchemeDependOnTarget(
                    rootProjectPath,
                    schemeName,
                    rootTargetName,
                    includeTargets.join(","),
                    excludeTargets.join(",")
                )
        );
    }

    async addTestSchemeDependOnTargetToProjects(
        rootTargetName: string,
        testTargets: string | undefined
    ): Promise<{ scheme: string; path: string; projectPath: string } | undefined> {
        return this.generateScheme(
            rootTargetName,
            (rootProjectPath: string, schemeName: string, rootTargetName: string) =>
                this.rubyProjectFilesManager.generateTestSchemeDependOnTarget(
                    rootProjectPath,
                    schemeName,
                    rootTargetName,
                    testTargets
                )
        );
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
                const targets = await this.rubyProjectFilesManager.listTargetsForFile(
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
            try {
                await this.projectCache.update(project, projectFile => {
                    return this.rubyProjectFilesManager.listFilesFromProject(projectFile);
                });
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

export async function getProjectFiles(project: string) {
    if (project.indexOf(".xcworkspace") !== -1) {
        const xmlData = fs.readFileSync(path.join(project, "contents.xcworkspacedata"), "utf-8");

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
