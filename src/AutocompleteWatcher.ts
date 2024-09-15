import * as vscode from "vscode";
import { Executor, ExecutorMode, ExecutorReturnType, ExecutorRunningError } from "./execShell";
import { getWorkspacePath, getProjectScheme } from "./env";
import { emptyAutobuildLog } from "./utils";
import { sleep } from "./extension";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { ProjectManager } from "./ProjectManager/ProjectManager";
import { AtomicCommand, UserCommandIsExecuting } from "./AtomicCommand";
import { error } from "console";

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
    private atomicCommand: AtomicCommand;
    private problemResolver: ProblemDiagnosticResolver;
    private projectManager: ProjectManager;
    private selectedDocument: vscode.TextDocument | undefined = undefined;
    private textOfSelectedDocument: string | undefined = undefined;

    private state: State = State.ModuleNotChanged;
    private moduleChangedName: string[] | undefined;
    private terminatingExtension: boolean = false

    private buildId = 0;

    constructor(atomicCommand: AtomicCommand, problemResolver: ProblemDiagnosticResolver, projectManager: ProjectManager) {
        this.atomicCommand = atomicCommand;
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
        this.problemResolver = problemResolver;
        this.projectManager = projectManager;
    }

    triggerIncrementalBuild() {
        if (!this.isWatcherEnabled())
            return;
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

    private async incrementalBuild(buildId: number): Promise<any> {
        try {
            await this.atomicCommand.autoWatchCommand(async () => {
                if (this.buildId !== buildId || !this.isWatcherEnabled())
                    return;
                try {
                    const scheme = getProjectScheme();
                    emptyAutobuildLog();
                    this.problemResolver.parseAsyncLogs(
                        getWorkspacePath(),
                        ".logs/autocomplete.log",
                        false
                    );
                    await this.atomicCommand.executor.execShell(
                        AutocompleteWatcher.AutocompleteCommandName,
                        "compile_module.sh",
                        [scheme],
                        false,
                        ExecutorReturnType.statusCode,
                        ExecutorMode.silently
                    );
                } catch (err) {
                }
            });
        } catch (err) {
            if (err == UserCommandIsExecuting) {
                await sleep(1000);
                if (buildId == this.buildId) // still valid
                    this.incrementalBuild(buildId);
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