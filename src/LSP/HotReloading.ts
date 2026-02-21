import { getScriptPath } from "../env";
import { Executor, ShellProcessResult } from "../Executor";
import * as vscode from "vscode";
import { LogChannelInterface } from "../Logs/LogChannel";

function hotReloadingEnabled() {
    const isEnabled = vscode.workspace.getConfiguration("vscode-ios").get("hotreload.enabled");
    if (!isEnabled) {
        return false;
    }
    return true;
}

function watchHotReloadingSetting(hotReloading: HotReloadingInterface) {
    return vscode.workspace.onDidChangeConfiguration(async event => {
        if (event.affectsConfiguration("vscode-ios.hotreload.enabled")) {
            if (!hotReloadingEnabled()) {
                hotReloading.shutdown();
            } else {
                hotReloading.resume();
            }
        }
    });
}

export interface HotReloadingInterface {
    start(buildRoot: string, workspace: string): void;
    resume(): void;
    shutdown(): void;
}

export class HotReloading implements HotReloadingInterface, vscode.Disposable {
    private hotReloadingProcFlagsProviderProc?: ShellProcessResult;

    private buildRoot?: string;
    private workspace?: string;

    private disposable: vscode.Disposable[] = [];

    constructor(private log: LogChannelInterface) {
        this.disposable.push(watchHotReloadingSetting(this));
    }

    start(buildRoot: string, workspace: string): void {
        if (
            this.hotReloadingProcFlagsProviderProc &&
            this.buildRoot === buildRoot &&
            this.workspace === workspace
        ) {
            // already started with the same parameters, no need to restart
            return;
        }
        this.buildRoot = buildRoot;
        this.workspace = workspace;

        if (!hotReloadingEnabled()) {
            this.log.info(
                "Hot Reloading is disabled in settings, skipping starting hot reloading support"
            );
            return;
        }

        this.shutdown();
        const scriptPath = getScriptPath("hotreload_log_accumulator.py");
        this.hotReloadingProcFlagsProviderProc = new Executor().execShellAndProc({
            scriptOrCommand: { command: scriptPath },
            args: [buildRoot, workspace],
        });
        this.hotReloadingProcFlagsProviderProc.result.catch(error => {
            this.log.error(
                `HotReloading could not work for some files. Failed to start hot reloading flags accumulator: ${String(error)}`
            );
        });
    }

    resume(): void {
        if (this.buildRoot && this.workspace) {
            this.start(this.buildRoot, this.workspace);
        }
    }

    shutdown(): void {
        if (this.hotReloadingProcFlagsProviderProc) {
            this.hotReloadingProcFlagsProviderProc.proc.kill("SIGTERM");
            this.hotReloadingProcFlagsProviderProc = undefined;
        }
    }

    dispose(): void {
        this.shutdown();
        this.disposable.forEach(d => d.dispose());
        this.disposable = [];
    }
}
