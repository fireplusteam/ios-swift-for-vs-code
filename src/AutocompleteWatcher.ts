import * as vscode from "vscode";
import { ExecutorMode } from "./Executor";
import { getWorkspacePath, getProjectScheme, isActivated } from "./env";
import { emptyAutobuildLog } from "./utils";
import { sleep } from "./extension";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { ProjectManager } from "./ProjectManager/ProjectManager";
import { AtomicCommand, UserCommandIsExecuting } from "./CommandManagement/AtomicCommand";

// Workaround to use build to update index, sourcekit doesn't support updating indexes in background
export class AutocompleteWatcher {
    static AutocompleteCommandName = "Watch";

    private disposable: vscode.Disposable[] = [];
    private atomicCommand: AtomicCommand;
    private problemResolver: ProblemDiagnosticResolver;
    private projectManager: ProjectManager;

    private terminatingExtension: boolean = false;

    private buildId = 0;

    constructor(
        atomicCommand: AtomicCommand,
        problemResolver: ProblemDiagnosticResolver,
        projectManager: ProjectManager
    ) {
        this.atomicCommand = atomicCommand;
        this.disposable.push(
            vscode.workspace.onDidSaveTextDocument(e => {
                if (!e || !this.isWatcherEnabledAnyFile()) {
                    return;
                }

                this.triggerIncrementalBuild().catch(() => {});
            })
        );
        this.problemResolver = problemResolver;
        this.projectManager = projectManager;
    }

    async triggerIncrementalBuild() {
        if ((await this.isWatcherEnabledAnyFile()) === false) {
            return;
        }
        this.buildId++;
        await this.incrementalBuild(this.buildId);
    }

    terminate() {
        this.terminatingExtension = true;
    }

    private async isWatcherEnabledAnyFile() {
        if ((await isActivated()) === false) {
            return false;
        }
        const isWatcherEnabled = vscode.workspace
            .getConfiguration("vscode-ios")
            .get("watcher.singleModule");
        if (!isWatcherEnabled || this.terminatingExtension) {
            return false;
        }
        return true;
    }

    private isValidFile(filePath: string | undefined) {
        if (
            filePath &&
            (filePath.endsWith(".swift") || filePath.endsWith(".m") || filePath.endsWith(".mm"))
        ) {
            return true;
        }
        return false;
    }

    private async incrementalBuild(buildId: number): Promise<any> {
        try {
            await this.atomicCommand.autoWatchCommand(async context => {
                if (this.buildId !== buildId || (await this.isWatcherEnabledAnyFile()) === false) {
                    return;
                }
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
                    ExecutorMode.onlyCommandNameAndResult
                );
            });
        } catch (err) {
            if (err === UserCommandIsExecuting) {
                await sleep(1000);
                if (buildId === this.buildId) {
                    // still valid
                    this.incrementalBuild(buildId).catch(() => {});
                } // do nothing
            } else {
                throw err;
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
