import * as fs from "fs";
import { ExecutorMode } from "../Executor";
import { deleteFile } from "../utils";
import { getFilePathInWorkspace } from "../env";
import { CommandContext } from "./CommandContext";

export class BundlePath {
    private number = 0;

    private name: string;

    constructor(name: string) {
        this.name = name;
        this.deleteExistingFilesIfAny();
    }

    private BundlePath(number: number): string {
        return `.vscode/xcode/.${this.name}_${number}`;
    }
    private BundleResultPath(number: number): string {
        return `${this.BundlePath(number)}.xcresult`;
    }

    private deleteExistingFilesIfAny() {
        deleteFile(getFilePathInWorkspace(this.bundlePath()));
        deleteFile(getFilePathInWorkspace(this.bundleResultPath()));
    }

    generateNext() {
        ++this.number;
        this.deleteExistingFilesIfAny();
    }

    bundlePath() {
        return this.BundlePath(this.number);
    }

    bundleResultPath() {
        return this.BundleResultPath(this.number);
    }

    async merge(context: CommandContext) {
        const resultBundles: string[] = [];
        for (let i = 0; i <= this.number; ++i) {
            const filePath = getFilePathInWorkspace(this.BundleResultPath(i));
            if (fs.existsSync(filePath)) {
                resultBundles.push(filePath);
            }
        }
        if (resultBundles.length <= 1) {
            return; // nothing to merge
        }
        // generate next bundle id to merge all results
        this.generateNext();
        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcrun xcresulttool" },
            args: [
                "merge",
                ...resultBundles,
                "--output-path",
                getFilePathInWorkspace(this.bundleResultPath()),
            ],
            mode: ExecutorMode.onlyCommandNameAndResult,
        });
    }
}
