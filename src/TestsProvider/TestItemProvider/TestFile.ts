import * as vscode from "vscode";
import { parseSwiftSource } from "./parseClass";
import { TestContainer } from "./TestContainer";
import { TestHeading as TestSuite } from "./TestHeading";
import { TestTreeContext, getContentFromFilesystem } from "../TestTreeContext";
import { getTestIDComponents } from "../../LSP/lspExtension";
import { TestCase } from "./TestCase";
import { LSPTestItem } from "../../LSP/GetTestsRequest";
import path = require("path");

let generationCounter = 0;

export class TestFile implements TestContainer {
    public didResolve = false;
    context: TestTreeContext;
    private target: string;
    private projectFile: string;
    private fileContent: string | undefined;

    constructor(context: TestTreeContext, projectFile: string, target: string) {
        this.context = context;
        this.target = target;
        this.projectFile = projectFile;
    }

    private mapTestItems(
        parent: vscode.TestItem,
        target: string | undefined,
        lspTest: LSPTestItem,
        suiteGeneration: number
    ): vscode.TestItem[] {
        let lspTestId = lspTest.id;
        if (lspTestId.includes("dummy.swift:")) {
            lspTestId = lspTest.id.split(path.sep).slice(0, -1).join(path.sep);
        }
        const id = `${parent.uri}/${lspTest.id}`;
        const testItem = this.context.ctrl.createTestItem(id, lspTest.label, parent.uri);
        testItem.range = new vscode.Range(
            new vscode.Position(
                lspTest.location.range.start.line,
                lspTest.location.range.start.character
            ),
            new vscode.Position(
                lspTest.location.range.end.line,
                lspTest.location.range.end.character
            )
        );
        if (lspTest.children.length !== 0) {
            const test = new TestSuite(suiteGeneration);
            this.context.testData.set(testItem, test);
        } else {
            const idComponents = getTestIDComponents(lspTestId);
            const test = new TestCase(
                this.projectFile,
                idComponents.testName,
                idComponents.suite,
                target,
                lspTest.style
            );
            this.context.testData.set(testItem, test);
        }
        const itemChildren: vscode.TestItem[] = [];
        for (const lspChild of lspTest.children) {
            itemChildren.push(
                ...this.mapTestItems(testItem, target, lspChild, suiteGeneration + 1)
            );
        }
        this.context.replaceItemsChildren(testItem, itemChildren);
        return [testItem];
    }

    public async updateFromDisk(controller: vscode.TestController, item: vscode.TestItem) {
        try {
            const content = await getContentFromFilesystem(item.uri!);
            if (content !== this.fileContent) {
                this.fileContent = content;
                item.error = undefined;
                await this.updateFromContents(controller, content, item);
            }
        } catch (e) {
            item.error = (e as Error).stack;
        }
    }

    public async updateFromContents(
        controller: vscode.TestController,
        content: string,
        item: vscode.TestItem
    ) {
        try {
            const url = item.uri!;
            const tests = await this.context.lspTestProvider.fetchTests(url, content);

            const itemChildren: vscode.TestItem[] = [];
            const target = this.target;
            for (const lspChild of tests) {
                itemChildren.push(...this.mapTestItems(item, target, lspChild, 1));
            }
            this.context.replaceItemsChildren(item, itemChildren);
        } catch {
            // legacy fallback
            const ancestors = [{ item, children: [] as vscode.TestItem[] }];
            const thisGeneration = generationCounter++;

            const ascend = (depth: number) => {
                while (ancestors.length > depth) {
                    const finished = ancestors.pop()!;
                    this.context.replaceItemsChildren(finished.item, finished.children);
                }
            };

            parseSwiftSource(content, {
                onTest: (range: vscode.Range, testName: string) => {
                    const parent = ancestors[ancestors.length - 1];
                    const data = new TestCase(
                        this.projectFile,
                        testName,
                        parent.item.label,
                        this.target,
                        "XCTest"
                    );
                    const id = `${item.uri}/${data.getLabel()}`;

                    const tcase = controller.createTestItem(id, data.getLabel(), item.uri);
                    this.context.testData.set(tcase, data);
                    tcase.range = range;
                    parent.children.push(tcase);
                },

                onHeading: (range, name) => {
                    const parent = ancestors[ancestors.length - 1];
                    const id = `${item.uri}/${name}`;

                    const thead = controller.createTestItem(id, name, item.uri);
                    thead.range = range;
                    this.context.testData.set(thead, new TestSuite(thisGeneration));
                    parent.children.push(thead);
                    ancestors.push({ item: thead, children: [] });
                },
            });

            ascend(0); // finish and assign children for all remaining items
        }
        this.didResolve = true;
    }
}
