import * as fs from "fs";
import { createFifo } from "../utils";
import { getWorkspacePath } from "../env";
import path from "path";
import {
    RuntimeWarningMessageNode,
    RuntimeWarningStackNode,
    RuntimeWarningsDataProvider,
} from "./RuntimeWarningsDataProvider";
import { error } from "console";
import { createInterface, Interface } from "readline";

export class RuntimeWarningsLogWatcher {
    private static LogPath = ".vscode/xcode/fifo/.app_runtime_warnings.fifo";

    private panel: RuntimeWarningsDataProvider;
    private rl?: Interface;
    private stream?: fs.ReadStream;

    private cachedContent: string = "";

    static get logPath(): string {
        return path.join(getWorkspacePath(), RuntimeWarningsLogWatcher.LogPath);
    }

    constructor(panel: RuntimeWarningsDataProvider) {
        this.panel = panel;
    }

    public async startWatcher() {
        try {
            // await deleteFifo(RuntimeWarningsLogWatcher.logPath);
        } catch (error) {
            console.log(`Error deleting fifo file: ${error}`);
        }
        await createFifo(RuntimeWarningsLogWatcher.logPath);
        try {
            this.panel.refresh([]);
            this.cachedContent = "";
            this.updateTree("");
        } catch {
            /* empty */
        }

        if (this.rl === undefined || this.stream?.closed === true) {
            this.startWatcherImp();
        }
    }

    private async startWatcherImp() {
        try {
            const stream = fs.createReadStream(RuntimeWarningsLogWatcher.logPath, { flags: "r" });
            this.stream = stream;

            const rl = createInterface({ input: stream, crlfDelay: Infinity });
            this.rl = rl;
            for await (const line of rl) {
                this.readContent(line);
            }
        } catch (error) {
            console.log(`FIFO file for warnings log got error: ${error}`);
        }
    }

    private readContent(data: string) {
        try {
            this.updateTree(data);
        } catch {
            /* empty */
        }
    }

    disposeWatcher() {
        this.rl?.close();
        this.stream?.close();
        this.rl = undefined;
        this.stream = undefined;
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
