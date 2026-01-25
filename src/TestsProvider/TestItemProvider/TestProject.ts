import * as vscode from "vscode";
import { TestTreeContext } from "../TestTreeContext";
import { TestContainer } from "./TestContainer";
import { TestTarget } from "./TestTarget";
import { getFilePathInWorkspace } from "../../env";

export class TestProject implements TestContainer {
    private _lastUrl: vscode.Uri | undefined;
    async didResolveImp(): Promise<boolean> {
        if (this._lastUrl) {
            const watcher = this.context.projectWatcher.newFileChecker(
                getFilePathInWorkspace(this._lastUrl.fsPath),
                "TestProjectFile"
            );
            return !(await watcher.isFileChanged());
        }
        return false;
    }

    public get didResolve(): Promise<boolean> {
        return this.didResolveImp();
    }

    public context: TestTreeContext;

    public targetProvider: () => Promise<string[]>;
    public filesForTargetProvider: (target: string) => Promise<string[]>;

    constructor(
        context: TestTreeContext,
        targetProvider: () => Promise<string[]>,
        filesForTargetProvider: (target: string) => Promise<string[]>
    ) {
        this.context = context;
        this.targetProvider = targetProvider;
        this.filesForTargetProvider = filesForTargetProvider;
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
        const targets = await this.targetProvider();
        const weakRef = new WeakRef(this);
        this._lastUrl = item.uri;

        for (const target of targets) {
            const url = TestTreeContext.getTargetFilePath(item.uri, target);
            const { file, data } = this.context.getOrCreateTest("target://", url, () => {
                return new TestTarget(this.context, item.uri?.fsPath || "", target, async () => {
                    return (await weakRef.deref()?.filesForTargetProvider(target)) || [];
                });
            });

            if (!(await data.didResolve)) {
                await data.updateFromDisk(controller, file);
            }
            if ([...file.children].length > 0) {
                parent.children.push(file);
            } else {
                this.context.deleteItem(file.id);
            }
        }

        // finish
        this.context.replaceItemsChildren(item, parent.children);
    }
}
