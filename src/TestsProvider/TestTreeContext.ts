import { TextDecoder } from "util";
import * as vscode from "vscode";
import { TestContainer } from "./TestItemProvider/TestContainer";
import { TestCase } from "./TestItemProvider/TestCase";
import { TestHeading } from "./TestItemProvider/TestHeading";
import { CoverageProvider } from "./CoverageProvider";
import { LSPTestsProvider } from "../LSP/LSPTestsProvider";
import { TestResultProvider } from "./TestResultProvider";
import { AtomicCommand } from "../CommandManagement/AtomicCommand";
import * as path from "path";

const textDecoder = new TextDecoder("utf-8");

export type MarkdownTestData = TestHeading | TestCase | TestContainer;

type TestNodeId = "file://" | "target://" | "project://";

export class TestTreeContext {
    readonly testData = new WeakMap<vscode.TestItem, MarkdownTestData>();
    readonly reusedTestItems = new Map<string, vscode.TestItem>();

    readonly ctrl: vscode.TestController = vscode.tests.createTestController(
        "iOSTestController",
        "iOS Tests"
    );
    readonly coverage: CoverageProvider = new CoverageProvider();
    readonly testResult: TestResultProvider = new TestResultProvider();
    readonly lspTestProvider: LSPTestsProvider;
    readonly atomicCommand: AtomicCommand;

    constructor(lspTestProvider: LSPTestsProvider, atomicCommand: AtomicCommand) {
        this.lspTestProvider = lspTestProvider;
        this.atomicCommand = atomicCommand;
    }

    static TestID(id: TestNodeId, uri: vscode.Uri) {
        return `${id}/${uri.toString()}`;
    }

    static getTargetFilePath(projectPath: vscode.Uri | undefined, target: string) {
        return vscode.Uri.file(`${projectPath?.toString() || ""}/${target}`);
    }

    static getLabelFromUri(uri: vscode.Uri) {
        if (path.basename(uri.path).toLowerCase() === "package.swift") {
            return uri.path.split("/").at(-2) || uri.toString();
        }
        return uri.path.split("/").pop() || uri.toString();
    }

    clear() {
        this.ctrl.items.replace([]);
    }

    getOrCreateTest(id: TestNodeId, uri: vscode.Uri, provider: () => any) {
        const uniqueId = TestTreeContext.TestID(id, uri);
        const existing = this.get(uniqueId, this.ctrl.items);
        if (existing) {
            if (!this.testData.has(existing)) {
                const data = provider();
                this.testData.set(existing, data);
            }
            return { file: existing, data: this.testData.get(existing) };
        }

        const file = this.ctrl.createTestItem(uniqueId, TestTreeContext.getLabelFromUri(uri), uri);
        this.ctrl.items.add(file);

        const data = provider();
        this.testData.set(file, data);
        this.reusedTestItems.set(uniqueId, file);

        file.canResolveChildren = true;
        return { file, data };
    }

    private get(key: string, items: vscode.TestItemCollection) {
        const file = this.reusedTestItems.get(key);
        if (file) {
            // fast find by checking if we can achieve one of the root items, if not, then it was removed
            // it reduces the need to do a full tree traversal each time
            let parent: vscode.TestItem | undefined = file;
            while (parent) {
                if (parent.parent === undefined) {
                    if (items.get(parent.id)) {
                        return file;
                    }
                    break;
                }
                // if an item is removed from parent children, but still has a parent reference, we can detect it here
                else if (parent.parent.children.get(parent.id) === undefined) {
                    break;
                }
                parent = parent?.parent;
            }
            // this item was removed from the tree, so clean up for the next time
            this.reusedTestItems.delete(key);
            return undefined;
        }
    }

    addItem(item: vscode.TestItem, shouldAdd: (root: vscode.TestItem) => boolean) {
        let res = false;
        this.ctrl.items.forEach(childItem => {
            if (res) {
                return;
            }
            res = res || this.addItemImp(item, childItem, shouldAdd);
        });
        return res;
    }

    private addItemImp(
        item: vscode.TestItem,
        root: vscode.TestItem,
        shouldAdd: (root: vscode.TestItem) => boolean
    ) {
        if (shouldAdd(root)) {
            // found
            root.children.add(item);
            return true;
        } else {
            let res = false;
            root.children.forEach(childItem => {
                if (res) {
                    return;
                }
                res = res || this.addItemImp(item, childItem, shouldAdd);
            });
            return res;
        }
    }

    deleteItem(id: string | vscode.TestItem) {
        let tree: vscode.TestItem | undefined;
        if (typeof id === "string") {
            tree = this.get(id, this.ctrl.items);
        } else {
            tree = id;
        }
        if (tree) {
            if (tree.parent) {
                tree.parent.children.delete(tree.id);
            } else {
                this.ctrl.items.delete(tree.id);
            }
        }
    }

    public replaceItemsChildren(item: vscode.TestItem, itemsChildren: vscode.TestItem[]) {
        item.children.replace(itemsChildren);
    }

    allTestItems() {
        const list = [] as vscode.TestItem[];
        this.ctrl.items.forEach(item => {
            this.allTestItemsImp(list, item);
        });
        return list;
    }

    private allTestItemsImp(list: vscode.TestItem[], root: vscode.TestItem) {
        list.push(root);
        root.children.forEach(item => {
            this.allTestItemsImp(list, item);
        });
    }
}

export const getContentFromFilesystem = async (uri: vscode.Uri) => {
    try {
        const rawContent = await vscode.workspace.fs.readFile(uri);
        return textDecoder.decode(rawContent);
    } catch (e) {
        console.warn(`Error providing tests for ${uri.fsPath}`, e);
        return "";
    }
};
