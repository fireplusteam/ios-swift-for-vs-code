import * as vscode from "vscode";
import { LogChannelInterface } from "../Logs/LogChannel";
import { getWorkspacePath } from "../env";

export interface ProjectWatcherInterface extends vscode.Disposable {
    newFileWatcher(filePath: string): ProjectFileWatcherInterface;
    newFileChecker(filePath: string, id: string): ProjectFileCheckerInterface;
}

interface ProjectWatcherTimestamp {
    watcherTimeStamps(filePath: string): number;
    checkerTimeStamps(filePath: string): number;
}

// A watcher that emits events on file changes
export interface ProjectFileWatcherInterface {
    onFileChanged: vscode.Event<void>;
}

// A checker just checks if the file is changed without event subscription
export interface ProjectFileCheckerInterface {
    isFileChanged(): Promise<boolean>;
}

interface ProjectFileWatcherImp {
    notify(projectFilePath: string): Promise<boolean>;
}

export class ProjectWatcher implements ProjectWatcherInterface, ProjectWatcherTimestamp {
    private disposable: vscode.Disposable[] = [];
    private watchers: Map<
        string,
        { timestamps: number; watcher: ProjectFileWatcherInterface & ProjectFileWatcherImp }
    > = new Map();

    private checkers = new Map<
        string,
        { timestamps: number; checker: ProjectFileCheckerInterface }
    >();

    constructor(private log: LogChannelInterface) {}

    public start() {
        // if already started
        this.dispose();

        const watcher = vscode.workspace.createFileSystemWatcher({
            baseUri: vscode.Uri.file(getWorkspacePath()),
            base: getWorkspacePath(),
            pattern: "**/*.{xcodeproj/project.pbxproj,swift}",
        });
        watcher.onDidChange(e => {
            this.log.debug(`File changed: ${e.fsPath}`);
            const entry = this.watchers.get(e.fsPath);
            if (entry) {
                entry.timestamps = Date.now();
                entry.watcher.notify(e.fsPath);
            }
        });
        this.disposable.push(watcher);
    }

    dispose() {
        this.watchers.clear();
        this.checkers.clear();
        this.disposable.forEach(d => d.dispose());
    }

    newFileWatcher(filePath: string): ProjectFileWatcherInterface {
        if (!this.watchers.has(filePath)) {
            const watcherEntry = new ProjectFileWatcher(filePath, this);
            this.watchers.set(filePath, { timestamps: Date.now(), watcher: watcherEntry });
            return watcherEntry;
        }
        return this.watchers.get(filePath)!.watcher;
    }

    newFileChecker(filePath: string, id: string): ProjectFileCheckerInterface {
        const key = `${filePath}|^|^|${id}`;
        if (!this.checkers.has(key)) {
            const checker = new ProjectFileWatcher(key, this);
            this.checkers.set(key, { timestamps: Date.now(), checker: checker });
            return checker;
        }
        return this.checkers.get(key)!.checker;
    }

    watcherTimeStamps(filePath: string): number {
        const entry = this.watchers.get(filePath);
        if (entry) {
            return entry.timestamps;
        }
        return 0;
    }

    checkerTimeStamps(filePath: string): number {
        const entry = this.checkers.get(filePath);
        if (entry) {
            return entry.timestamps;
        }
        return 0;
    }
}

class ProjectFileWatcher
    implements ProjectFileWatcherInterface, ProjectFileWatcherImp, ProjectFileCheckerInterface
{
    private timestamp: number = 0;
    private _onFileChanged: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onFileChanged: vscode.Event<void> = this._onFileChanged.event;

    constructor(
        readonly key: string,
        readonly watcher: ProjectWatcherTimestamp
    ) {
        this.timestamp = this.watcher.watcherTimeStamps(key);
    }

    async notify(projectFilePath: string): Promise<boolean> {
        const timestamp = this.watcher.watcherTimeStamps(projectFilePath);
        if (this.timestamp < timestamp) {
            this.timestamp = timestamp;
            this._onFileChanged.fire();
            return true;
        }
        return false;
    }

    async isFileChanged(): Promise<boolean> {
        const timestamp = this.watcher.checkerTimeStamps(this.key);
        if (this.timestamp < timestamp) {
            this.timestamp = timestamp;
            return true;
        }
        return false;
    }
}
