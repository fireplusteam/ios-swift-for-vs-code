import * as fs from "fs";
import { Executor } from "../Executor";
import { deleteFile } from "../utils";
import { getFilePathInWorkspace } from "../env";

let globalId = 0;
function generateGlobalId() {
    return ++globalId;
}

export class BundlePath {
    private number: number;
    private allBundles: number[] = [];

    private name: string;

    constructor(name: string) {
        this.name = name;
        this.deleteExistingFilesIfAny();
        this.number = generateGlobalId();
        this.allBundles.push(this.number);
    }

    private BundlePath(number: number): string {
        return `.vscode/xcode/bundles/.${this.name}_${number}`;
    }
    private BundleResultPath(number: number): string {
        return `${this.BundlePath(number)}.xcresult`;
    }

    private deleteExistingFilesIfAny() {
        deleteFile(getFilePathInWorkspace(this.bundlePath()));
        deleteFile(getFilePathInWorkspace(this.bundleResultPath()));
    }

    generateNext() {
        this.number = generateGlobalId();
        this.deleteExistingFilesIfAny();
        this.allBundles.push(this.number);
    }

    bundlePath() {
        return this.BundlePath(this.number);
    }

    bundleResultPath() {
        return this.BundleResultPath(this.number);
    }

    async merge() {
        const resultBundles: string[] = [];
        for (const i of this.allBundles) {
            const filePath = getFilePathInWorkspace(this.BundleResultPath(i));
            if (fs.existsSync(filePath)) {
                resultBundles.push(filePath);
            }
        }
        if (resultBundles.length <= 1) {
            return; // nothing to merge
        }
        // generate next bundle id to merge all results
        this.allBundles = [];
        this.generateNext();
        await new Executor().execShell({
            scriptOrCommand: { command: "xcrun xcresulttool" },
            args: [
                "merge",
                ...resultBundles,
                "--output-path",
                getFilePathInWorkspace(this.bundleResultPath()),
            ],
        });
    }
}
