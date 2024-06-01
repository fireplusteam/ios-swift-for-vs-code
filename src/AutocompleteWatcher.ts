import * as vscode from "vscode";
import { Executor, ExecutorMode, ExecutorReturnType, ExecutorRunningError } from "./execShell";
import { getWorkspacePath, getProjectScheme } from "./env";
import { emptyAutobuildLog } from "./utils";
import { sleep } from "./extension";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { ProjectManager } from "./ProjectManager/ProjectManager";

class AutocompleteCancel extends Error {
}

enum State {
    ModuleNotChanged,
    ModuleChanged
}

enum BuildState {
    NotRunning,
    Running,
    Cancelling
}

// Workaround to use build to update index, sourcekit doesn't support updating indexes in background
export class AutocompleteWatcher {

    static AutocompleteCommandName = "Autocomplete Build";

    private disposable: vscode.Disposable[] = [];
    private buildExecutor: Executor;
    private problemResolver: ProblemDiagnosticResolver;
    private projectManager: ProjectManager;
    private selectedDocument: vscode.TextDocument | undefined = undefined;
    private textOfSelectedDocument: string | undefined = undefined;

    private state: State = State.ModuleNotChanged;
    private moduleChangedName: string[] | undefined;
    private terminatingExtension: boolean = false

    private buildId = 0;

    constructor(buildExecutor: Executor, problemResolver: ProblemDiagnosticResolver, projectManager: ProjectManager) {
        this.disposable.push(vscode.window.onDidChangeActiveTextEditor(async (e) => {
            if (!e || !this.isWatcherEnabled()) {
                return;
            }

            switch (this.state) {
                case State.ModuleNotChanged:
                    const filePath = this.selectedDocument?.uri.fsPath;
                    if (!filePath || !this.isValidFile(filePath)) {
                        break;
                    }
                    const text = this.selectedDocument?.getText();
                    if (text !== this.textOfSelectedDocument && this.textOfSelectedDocument !== undefined) {
                        const moduleName = await this.getModuleNameByFileName(filePath);
                        if (moduleName.toString() !== [].toString()) {
                            this.moduleChangedName = moduleName;
                            this.state = State.ModuleChanged;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                // fallthrough and check the current module
                case State.ModuleChanged:
                    const pickedNextFilePath = e.document?.uri.fsPath;
                    if (!this.isValidFile(pickedNextFilePath)) {
                        break;
                    }
                    const moduleName = await this.getModuleNameByFileName(pickedNextFilePath);
                    if (moduleName.toString() !== [].toString() && moduleName.toString() !== this.moduleChangedName?.toString()) {
                        this.state = State.ModuleNotChanged;
                        this.moduleChangedName = moduleName;

                        this.triggerIncrementalBuild();
                    }
            }
            this.textOfSelectedDocument = e.document.getText();
            this.selectedDocument = e.document;
        }));
        this.buildExecutor = buildExecutor;
        this.problemResolver = problemResolver;
        this.projectManager = projectManager;
    }

    triggerIncrementalBuild() {
        this.buildId++;
        this.incrementalBuild(this.buildId);
    }

    terminate() {
        this.terminatingExtension = true;
    }

    private isWatcherEnabled() {
        const isWatcherEnabled = vscode.workspace.getConfiguration("vscode-ios").get("watcher");
        if (!isWatcherEnabled || this.terminatingExtension) {
            return false;
        }
        return true;
    }

    private isValidFile(filePath: string | undefined) {
        if (filePath && (filePath.endsWith(".swift") || filePath.endsWith(".m") || filePath.endsWith(".mm"))) {
            return true;
        }
        return false;
    }


    private buildState: BuildState = BuildState.NotRunning;

    private async incrementalBuild(buildId: number): Promise<any> {
        if (this.buildId !== buildId || !this.isWatcherEnabled() || this.buildState === BuildState.Cancelling)
            return;
        try {
            if (this.buildState == BuildState.Running) {
                this.buildState = BuildState.Cancelling;
                await this.buildExecutor.terminateShell(new AutocompleteCancel("Cancelled"));
                await sleep(1500);
            }
            const scheme = getProjectScheme();
            emptyAutobuildLog();
            this.problemResolver.parseAsyncLogs(
                getWorkspacePath(),
                ".logs/autocomplete.log",
                false
            );
            this.buildState = BuildState.Running;
            await this.buildExecutor.execShell(
                AutocompleteWatcher.AutocompleteCommandName,
                "compile_module.sh",
                [scheme],
                false,
                ExecutorReturnType.statusCode,
                ExecutorMode.silently
            );
            this.buildState = BuildState.NotRunning;
        } catch (err) {
            if (err instanceof ExecutorRunningError) {
                if (this.buildId === buildId && err.commandName === AutocompleteWatcher.AutocompleteCommandName) {
                    if (this.buildState) {
                        this.buildState = BuildState.Cancelling;
                        await this.buildExecutor.terminateShell(new AutocompleteCancel("Cancelled"));
                        await sleep(1500);
                    }
                    if (this.buildState === BuildState.Cancelling) {
                        this.buildState = BuildState.NotRunning;
                        return await this.incrementalBuild(this.buildId);
                    }
                } else {
                    this.buildState = BuildState.NotRunning;
                }

                throw err;
            } else {
                this.buildState = BuildState.NotRunning;
            }
        }
    }

    private async getModuleNameByFileName(path: string) {
        try {
            return await this.projectManager.listTargetsForFile(path);
        } catch (err) {
            console.log(`Error on determine the file module: ${err}`);
            return [];
        }
    }
}