import * as fs from 'fs';
import * as vscode from "vscode";
import { FSWatcher, watch } from 'fs';
import { emptyAppLog, getAppLog } from "../utils";
import { getWorkspacePath } from '../env';
import path from 'path';
import { XcodeSidePanelDataProvider } from './XcodeSidePanelDataProvider';

export class RuntimeWarningsProvider {

    static LogPath = "runtime_warnings";

    panel: XcodeSidePanelDataProvider
    disposable: vscode.Disposable[] = [];
    fsWatcher: FSWatcher | undefined = undefined;
    cachedContent: string | undefined = undefined;

    get logPath(): string {
        return path.join(getWorkspacePath(), getAppLog(RuntimeWarningsProvider.LogPath));
    }

    constructor(panel: XcodeSidePanelDataProvider) {
        this.panel = panel;
    }

    private startWatcher() {
        // TODO: uncomment when it's done
        // emptyAppLog(RuntimeWarningPanel.LogPath);
        this.cachedContent = fs.readFileSync(this.logPath).toString();
        this.startWatcherImp();
    }

    private startWatcherImp() {
        this.fsWatcher = watch(this.logPath);

        this.fsWatcher.on("change", () => {
            const content = fs.readFileSync(this.logPath);
            const contentString = content.toString();
            if (this.cachedContent === undefined || this.cachedContent === contentString) {
                this.startWatcherImp();
                return;
            }
            this.updateTree(contentString);

            this.startWatcherImp();
        });
    }

    private disposeWatcher() {
        this.fsWatcher = undefined;
    }

    private updateTree(content: string) {
        //  convert to html
        this.panel.refresh();
    }

    public showRuntimeWarnings() {
        this.startWatcher();

        this.updateTree(this.cachedContent || "");
    }

    public hideRuntimeWarnings() {
        this.disposeWatcher();
    }
}