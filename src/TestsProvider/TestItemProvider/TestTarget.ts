import * as vscode from "vscode";
import { TestTreeContext } from "../TestTreeContext";
import { TestFile } from "./TestFile";
import { TestContainer } from "./TestContainer";
import { getFilePathInWorkspace } from "../../env";
import { ProjectWatcherInterface } from "../../ProjectManager/ProjectWatcher";

export class TestTarget implements TestContainer {
    private _didResolve = false;
    async didResolveImp(): Promise<boolean> {
        const watcher = this.projectWatcher.newFileChecker(
            getFilePathInWorkspace(this.projectFile),
            `TestProject.${this.target}`
        );
        return !(await watcher.isFileChanged()) && this._didResolve;
    }

    public get didResolve(): Promise<boolean> {
        return this.didResolveImp();
    }

    private context: TestTreeContext;
    private projectFile: string;
    private target: string;

    private filesForTargetProvider: () => Promise<string[]>;

    constructor(
        context: TestTreeContext,
        private projectWatcher: ProjectWatcherInterface,
        projectFile: string,
        target: string,
        filesForTargetProvider: () => Promise<string[]>
    ) {
        this.context = context;
        this.filesForTargetProvider = filesForTargetProvider;
        this.projectFile = projectFile;
        this.target = target;
    }

    public async updateFromDisk(controller: vscode.TestController, item: vscode.TestItem) {
        try {
            await this.updateFromContents(controller, "", item);
        } catch (e) {
            item.error = (e as Error).stack;
        }
    }

    public async updateFromContents(
        controller: vscode.TestController,
        content: string,
        item: vscode.TestItem
    ) {
        const parent = { item, children: [] as vscode.TestItem[] };
        const files = await this.filesForTargetProvider();
        for (const fileInTarget of files) {
            const url = vscode.Uri.file(fileInTarget);
            const { file, data } = this.context.getOrCreateTest("file://", url, () => {
                return new TestFile(
                    this.context,
                    this.projectWatcher,
                    this.projectFile,
                    item.label
                );
            });

            try {
                if (!(await data.didResolve)) {
                    await data.updateFromDisk(controller, file);
                }
                if ([...file.children].length > 0) {
                    parent.children.push(file);
                } else {
                    this.context.deleteItem(file.id);
                }
            } catch (err) {
                console.log(`Tests for a file ${url} can not be updated: ${err}`);
                this.context.deleteItem(file.id);
            }
        }
        this.context.replaceItemsChildren(item, parent.children);
        this._didResolve = true;
    }
}
