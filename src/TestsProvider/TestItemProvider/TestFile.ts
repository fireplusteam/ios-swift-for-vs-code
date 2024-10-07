import * as vscode from 'vscode';
import { parseMarkdown } from './parseClass';
import { TestContainer } from './TestContainer';
import { TestHeading } from './TestHeading';
import { TestTreeContext, getContentFromFilesystem } from '../TestTreeContext';
import { getTestIDComponents, LSPTestItem } from '../../LSP/lspExtension';
import { TestCase } from './TestCase';

let generationCounter = 0;

export class TestFile implements TestContainer {
    public didResolve = false;
    context: TestTreeContext;
    private target: string

    constructor(context: TestTreeContext, target: string) {
        this.context = context;
        this.target = target;
    }

    private mapTestItems(parent: vscode.TestItem, target: string | undefined, lspTest: LSPTestItem, controller: vscode.TestController, suiteGeneration: number): vscode.TestItem[] {
        const id = `${parent.uri}/${lspTest.id}`;
        const testItem = controller.createTestItem(id, lspTest.label, parent.uri);
        testItem.range = new vscode.Range(
            new vscode.Position(lspTest.location.range.start.line, lspTest.location.range.start.character),
            new vscode.Position(lspTest.location.range.end.line, lspTest.location.range.end.character)
        );
        if (lspTest.children.length != 0) {
            const test = new TestHeading(suiteGeneration);
            this.context.testData.set(testItem, test);
        } else {
            const idComponents = getTestIDComponents(lspTest.id);
            const test = new TestCase(idComponents.testName, idComponents.suite, target);
            this.context.testData.set(testItem, test);
        }
        const itemChildren: vscode.TestItem[] = [];
        for (const lspChild of lspTest.children) {
            itemChildren.push(...this.mapTestItems(testItem, target, lspChild, controller, suiteGeneration + 1));
        }
        testItem.children.replace(itemChildren);
        return [testItem];
    }

    public async updateFromDisk(controller: vscode.TestController, item: vscode.TestItem) {
        try {
            const content = await getContentFromFilesystem(item.uri!);
            item.error = undefined;
            await this.updateFromContents(controller, content, item);
        } catch (e) {
            item.error = (e as Error).stack;
        }
    }

    public async updateFromContents(controller: vscode.TestController, content: string, item: vscode.TestItem) {
        try {
            const url = item.uri!;
            const tests = await this.context.lspTestProvider.fetchTests(url, content);

            const itemChildren: vscode.TestItem[] = [];
            const target = this.target;
            for (const lspChild of tests) {
                itemChildren.push(...this.mapTestItems(item, target, lspChild, controller, 1));
            }
            item.children.replace(itemChildren);
        } catch { // legacy fallback
            const ancestors = [{ item, children: [] as vscode.TestItem[] }];
            const thisGeneration = generationCounter++;

            const ascend = (depth: number) => {
                while (ancestors.length > depth) {
                    const finished = ancestors.pop()!;
                    finished.item.children.replace(finished.children);
                }
            };

            parseMarkdown(content, {
                onTest: (range: vscode.Range, testName: string) => {
                    const parent = ancestors[ancestors.length - 1];
                    const data = new TestCase(testName, this.target, parent.item.parent?.label || "");
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
                    this.context.testData.set(thead, new TestHeading(thisGeneration));
                    parent.children.push(thead);
                    ancestors.push({ item: thead, children: [] });
                },
            });

            ascend(0); // finish and assign children for all remaining items
        }
        this.didResolve = true;
    }
}
