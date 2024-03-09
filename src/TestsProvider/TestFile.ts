import * as vscode from 'vscode';
import { parseMarkdown } from './testMarkdown';
import { TestContainer } from './TestContainer';
import { TestCase } from './TestCase';
import { TestHeading } from './TestHeading';
import { TestTreeContext, getContentFromFilesystem } from './TestTreeContext';

let generationCounter = 0;

export class TestFile implements TestContainer {
    public didResolve = false;
    context: TestTreeContext;
    
    constructor(context: TestTreeContext) {
        this.context = context;
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
        const ancestors = [{ item, children: [] as vscode.TestItem[] }];
        const thisGeneration = generationCounter++;
        this.didResolve = true;

        const ascend = (depth: number) => {
            while (ancestors.length > depth) {
                const finished = ancestors.pop()!;
                finished.item.children.replace(finished.children);
            }
        };

        parseMarkdown(content, {
            onTest: (range: vscode.Range, testName: string) => {
                const parent = ancestors[ancestors.length - 1];
                const data = new TestCase(testName);
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
}
