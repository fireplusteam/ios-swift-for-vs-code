import * as fs from "fs";
import { ExecutorMode } from "../Executor";
import { deleteFile } from "../utils";
import { getFilePathInWorkspace } from "../env";
import { CommandContext } from "./CommandContext";

export class BundlePath {
    private BundlePath(number: number): string {
        return `.vscode/xcode/.bundle_${number}`;
    }
    private BundleResultPath(number: number): string {
        return `${this.BundlePath(number)}.xcresult`;
    }

    private number = 0;

    constructor() {
        this.deleteExistingFilesIfAny();
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
        // const command = `xcrun xcresulttool merge /path/to/A.xcresult /path/to/B.xcresult --output-path merged.xcresult`;
        const resultBundles: string[] = [];
        for (let i = 0; i <= this.number; ++i) {
            const filePath = getFilePathInWorkspace(this.BundleResultPath(i));
            if (fs.existsSync(filePath)) {
                resultBundles.push(filePath);
            }
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
            mode: ExecutorMode.verbose,
        });
    }
}
