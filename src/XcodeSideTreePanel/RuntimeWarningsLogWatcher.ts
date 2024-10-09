import * as fs from "fs";
import { FSWatcher, watch } from "fs";
import { emptyAppLog, getAppLog } from "../utils";
import { getWorkspacePath } from "../env";
import path from "path";
import {
    RuntimeWarningMessageNode,
    RuntimeWarningStackNode,
    RuntimeWarningsDataProvider,
} from "./RuntimeWarningsDataProvider";
import { error } from "console";

export class RuntimeWarningsLogWatcher {
    private static LogPath = "runtime_warnings";

    private panel: RuntimeWarningsDataProvider;
    private fsWatcher: FSWatcher | undefined = undefined;
    private cachedContent: string = "";

    private get logPath(): string {
        return path.join(getWorkspacePath(), getAppLog(RuntimeWarningsLogWatcher.LogPath));
    }

    constructor(panel: RuntimeWarningsDataProvider) {
        this.panel = panel;
    }

    public startWatcher() {
        emptyAppLog(RuntimeWarningsLogWatcher.LogPath);
        try {
            this.panel.refresh([]);
            this.cachedContent = "";
            this.updateTree("");
        } catch {
            /* empty */
        }
        this.startWatcherImp();
    }

    private startWatcherImp() {
        this.disposeWatcher();
        this.fsWatcher = watch(this.logPath);

        this.fsWatcher.on("change", () => {
            this.readFileContent();
        });
    }

    private readFileContent(numOfTries = 0) {
        if (numOfTries >= 5) {
            // TODO: try 5 times, then give up
            this.startWatcherImp();
            return;
        }
        fs.readFile(this.logPath, (err, data) => {
            if (err) {
                this.startWatcherImp();
                return;
            }
            const contentString = data.toString();
            try {
                this.updateTree(contentString);
            } catch {
                this.readFileContent(numOfTries + 1);
                return;
            }

            this.startWatcherImp();
        });
    }

    private disposeWatcher() {
        this.fsWatcher?.close();
        this.fsWatcher = undefined;
    }

    private updateTree(content: string) {
        if (content === this.cachedContent) {
            return;
        }
        //  convert to html
        const elements: RuntimeWarningMessageNode[] = [];
        try {
            const root = JSON.parse(content);

            for (const element in root) {
                const value = root[element];
                console.log(element);
                const warning = new RuntimeWarningMessageNode(value.message, value.count, element);
                const stacks = value.data;
                for (const frame of stacks) {
                    if (
                        frame.file &&
                        frame.file.length > 0 &&
                        frame.file.indexOf("<compiler-generated>") === -1
                    ) {
                        const frameNode = new RuntimeWarningStackNode(
                            frame.function,
                            frame.line,
                            frame.file
                        );
                        warning.stack.push(frameNode);
                    }
                }

                elements.push(warning);
            }

            this.panel.refresh(elements);
        } catch {
            console.log(`Error of parsing runtime errors data: ${error}`);
            throw error;
        } finally {
            this.cachedContent = content;
        }
    }
}
