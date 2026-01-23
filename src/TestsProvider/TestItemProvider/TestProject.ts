import * as vscode from "vscode";
import { TestTreeContext } from "../TestTreeContext";
import { TestContainer } from "./TestContainer";
import { FSWatcher } from "fs";
import { TestTarget } from "./TestTarget";

export class TestProject implements TestContainer {
    public didResolve = false;

    public context: TestTreeContext;

    public targetProvider: () => Promise<string[]>;
    public filesForTargetProvider: (target: string) => Promise<string[]>;

    private fsWatcher: FSWatcher | undefined;
    private projectContent: Buffer | undefined;

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

        for (const target of targets) {
            const url = TestTreeContext.getTargetFilePath(item.uri, target);
            const { file, data } = this.context.getOrCreateTest("target://", url, () => {
                return new TestTarget(this.context, item.uri?.fsPath || "", async () => {
                    return (await weakRef.deref()?.filesForTargetProvider(target)) || [];
                });
            });

            if (!data.didResolve) {
                await data.updateFromDisk(controller, file);
            }
            if ([...file.children].length > 0) {
                parent.children.push(file);
            } else {
                this.context.deleteItem(file.id);
            }
        }

        this.didResolve = true;
        // finish

        this.context.replaceItemsChildren(item, parent.children);
    }
}
