import * as fs from 'fs';
import * as vscode from "vscode";
import { FSWatcher, watch } from 'fs';
import { emptyAppLog, getAppLog } from "../utils";
import { getWorkspacePath } from '../env';
import path from 'path';

export class RuntimeWarningPanel {

    static LogPath = "runtime_warnings";

    panel: vscode.WebviewPanel | undefined = undefined;
    disposable: vscode.Disposable[] = [];
    fsWatcher: FSWatcher | undefined = undefined;
    cachedContent: string | undefined = undefined;

    get logPath(): string {
        return path.join(getWorkspacePath(), getAppLog(RuntimeWarningPanel.LogPath));
    }

    constructor() {

    }

    private startWatcher() {
        // TODO: uncomment when it's done
        emptyAppLog(RuntimeWarningPanel.LogPath);
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
            this.updateHtml(contentString);

            this.startWatcherImp();
        });
    }

    private disposeWatcher() {
        this.fsWatcher = undefined;
    }

    private updateHtml(content: string) {
        //  convert to html
    }

    public showRuntimeWarnings() {
        this.startWatcher();

        this.panel = vscode.window.createWebviewPanel(
            'exampleWebView',
            'Xcode Runtime Warning',
            vscode.ViewColumn.One,
            {
                enableScripts: true
            }
        );
        this.panel.webview.html = "<html> HELLO </html>"

        this.disposable = [];
        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'openFile':
                        const documentPath = message.text;
                        vscode.workspace.openTextDocument(documentPath).then(doc => {
                            vscode.window.showTextDocument(doc);
                        });
                        return;
                }
            },
            undefined,
            this.disposable
        );

        this.updateHtml(this.cachedContent || "");

        this.panel.reveal(vscode.ViewColumn.Two, false);
    }

    public hideRuntimeWarnings() {
        this.disposeWatcher();

        this.panel?.dispose();
        this.disposable = [];
    }
}