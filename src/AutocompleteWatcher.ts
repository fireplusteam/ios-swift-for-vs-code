import * as vscode from "vscode";
import { ExecutorMode } from "./execShell";
import { getWorkspacePath, getProjectScheme } from "./env";
import { emptyAutobuildLog } from "./utils";
import { sleep } from "./extension";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { ProjectManager } from "./ProjectManager/ProjectManager";
import { AtomicCommand, UserCommandIsExecuting } from "./CommandManagement/AtomicCommand";

enum State {
    ModuleNotChanged,
    ModuleChanged
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
        this.disposable.push(vscode.workspace.onDidChangeTextDocument(e => {
            if (!e || !this.isWatcherEnabledAnyFile()) {
                return;
            }

            let isChanged = false;
            for (const ch of e.contentChanges) {
                if (ch.text.includes('\n')) // '' means deleted
                    isChanged = true;
            }
            this.triggerIncrementalBuild();
        }));
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
        const isWatcherEnabled = vscode.workspace.getConfiguration("vscode-ios").get("watcher.whole");
        if (!isWatcherEnabled || this.terminatingExtension) {
            return false;
        }
        return true;
    }

    private isWatcherEnabledAnyFile() {
        const isWatcherEnabled = vscode.workspace.getConfiguration("vscode-ios").get("watcher.singleModule");
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
            await this.atomicCommand.autoWatchCommand(async (context) => {
                if (this.buildId !== buildId || !this.isWatcherEnabled())
                    return;
                try {
                    const scheme = await getProjectScheme();
                    emptyAutobuildLog();
                    this.problemResolver.parseAsyncLogs(
                        getWorkspacePath(),
                        ".logs/autocomplete.log",
                        false
                    );
                    await context.execShell(
                        AutocompleteWatcher.AutocompleteCommandName,
                        { file: "compile_module.sh" },
                        [scheme],
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