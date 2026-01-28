import * as vscode from "vscode";
import { LogChannelInterface } from "../Logs/LogChannel";
import * as chokidar from "chokidar";
import * as path from "path";

export interface ProjectWatcherInterface extends vscode.Disposable {
    newFileWatcher(filePath: string): ProjectFileWatcherInterface;
    newFileChecker(filePath: string, id: string): ProjectFileCheckerInterface;
}

export interface ProjectWatcherTouchInterface {
    update(filePath: string): Promise<void>;
}

interface ProjectWatcherTimestamp {
    watcherTimeStamps(filePath: string): number;
    checkerTimeStamps(key: string): number;
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

export const watcherStabilityThreshold = 500;

export class ProjectWatcher
    implements ProjectWatcherInterface, ProjectWatcherTimestamp, ProjectWatcherTouchInterface
{
    private watchers: Map<
        string,
        { timestamps: number; watcher: ProjectFileWatcherInterface & ProjectFileWatcherImp }
    > = new Map();

    private _mainWatcher: chokidar.FSWatcher | undefined;

    private checkers = new Map<
        string,
        Map<string, { timestamps: number; checker: ProjectFileCheckerInterface }>
    >();

    constructor(private log: LogChannelInterface) {}

    private get mainWatcher(): chokidar.FSWatcher {
        if (!this._mainWatcher) {
            const watcher = chokidar.watch([], {
                persistent: true,
                ignoreInitial: true,
                depth: 32,
                awaitWriteFinish: {
                    stabilityThreshold: watcherStabilityThreshold,
                    pollInterval: 100,
                },
            });
            this._mainWatcher = watcher;
            watcher.on("change", (filePath: string) => {
                this.update(filePath);
            });
            return watcher;
        }
        return this._mainWatcher;
    }

    async update(filePath: string): Promise<void> {
        const ext = path.extname(filePath).toLowerCase();
        if (ext !== ".pbxproj" && ext !== ".swift") {
            return;
        }

        const components = filePath.split(path.sep).filter(c => c.length > 0) || [];
        let subPath = "";
        for (let i = 0; i < components.length; i++) {
            subPath += path.sep + components[i];
            const checkerEntries = this.checkers.get(subPath);
            if (checkerEntries) {
                for (const key of checkerEntries.keys()) {
                    const entry = checkerEntries.get(key);
                    if (entry) {
                        entry.timestamps = Date.now();
                    }
                }
            }
        }

        const watcherEntry = this.watchers.get(filePath);
        if (watcherEntry) {
            watcherEntry.timestamps = Date.now();
            watcherEntry.watcher.notify(filePath);
        }
    }

    private addPath(filePath: string) {
        this.mainWatcher.add(filePath);
    }

    dispose() {
        this.watchers.clear();
        this.checkers.clear();
        this._mainWatcher?.close();
        this._mainWatcher = undefined;
    }

    newFileWatcher(filePath: string): ProjectFileWatcherInterface {
        if (!this.watchers.has(filePath)) {
            this.addPath(filePath);
            const watcherEntry = new ProjectFileWatcher(filePath, this);
            this.watchers.set(filePath, { timestamps: Date.now(), watcher: watcherEntry });
            return watcherEntry;
        }
        return this.watchers.get(filePath)!.watcher;
    }

    newFileChecker(filePath: string, id: string): ProjectFileCheckerInterface {
        this.addPath(filePath);
        let checkerEntry = this.checkers.get(filePath);
        if (checkerEntry === undefined) {
            checkerEntry = new Map<
                string,
                { timestamps: number; checker: ProjectFileCheckerInterface }
            >();
            this.checkers.set(filePath, checkerEntry);
        }
        let entry = checkerEntry.get(id);
        if (entry === undefined) {
            const checker = new ProjectFileWatcher(`${filePath}|^|^|${id}`, this);
            entry = { timestamps: Date.now(), checker: checker };
            checkerEntry.set(id, entry);
            return checker;
        } else {
            return entry.checker;
        }
    }

    watcherTimeStamps(filePath: string): number {
        const entry = this.watchers.get(filePath);
        if (entry) {
            return entry.timestamps;
        }
        return 0;
    }

    checkerTimeStamps(key: string): number {
        const [filePath, id] = key.split("|^|^|");
        const checkerEntry = this.checkers.get(filePath);
        if (!checkerEntry) {
            return 0;
        }
        const entry = checkerEntry.get(id);
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
