import * as fs from "fs";
import * as vscode from "vscode";
import { createFifo } from "../utils";
import { getWorkspacePath } from "../env";
import * as path from "path";
import {
    RuntimeWarningMessageNode,
    RuntimeWarningStackNode,
    RuntimeWarningsDataProvider,
} from "./RuntimeWarningsDataProvider";
import { createInterface, Interface } from "readline";

export class RuntimeWarningsLogWatcher {
    private static LogPath = ".vscode/xcode/fifo/.app_runtime_warnings.fifo";

    private panel: RuntimeWarningsDataProvider;
    private rl?: Interface;
    private stream?: fs.ReadStream;

    private cachedContent: string = "";
    private log: vscode.OutputChannel;

    static get logPath(): string {
        return path.join(getWorkspacePath(), RuntimeWarningsLogWatcher.LogPath);
    }

    constructor(panel: RuntimeWarningsDataProvider, log: vscode.OutputChannel) {
        this.panel = panel;
        this.log = log;
    }

    public async startWatcher() {
        try {
            // await deleteFifo(RuntimeWarningsLogWatcher.logPath);
        } catch (error) {
            this.log.appendLine(`Error deleting fifo file: ${error}`);
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
            this.log.appendLine(`FIFO file for warnings log got error: ${error}`);
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
        } catch (error) {
            this.log.appendLine(`Error of parsing runtime errors data: ${error}`);
            throw error;
        } finally {
            this.cachedContent = content;
        }
    }
}
