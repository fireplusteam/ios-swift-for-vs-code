import * as vscode from "vscode";
import { TestTreeContext } from "../TestTreeContext";
import { TestFile } from "./TestFile";
import { TestContainer } from "./TestContainer";

export class TestTarget implements TestContainer {
    public didResolve = false;
    public context: TestTreeContext;

    public filesForTargetProvider: () => Promise<string[]>;

    constructor(context: TestTreeContext, filesForTargetProvider: () => Promise<string[]>) {
        this.context = context;
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
        const files = await this.filesForTargetProvider();
        for (const fileInTarget of files) {
            const url = vscode.Uri.file(fileInTarget);
            const { file, data } = this.context.getOrCreateTest("file://", url, () => {
                return new TestFile(this.context, item.label);
            });

            try {
                if (!data.didResolve) {
                    await data.updateFromDisk(controller, file);
                }
                if ([...file.children].length > 0) parent.children.push(file);
                else this.context.deleteItem(file.id);
            } catch (err) {
                console.log(`Tests for a file ${url} can not be updated: ${err}`);
                this.context.deleteItem(file.id);
            }
        }
        this.didResolve = true;
        // finish
        this.context.replaceItemsChildren(item, parent.children);
    }
}
