import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import { TestProject } from './TestProject';
import { TestTarget } from './TestTarget';
import path from 'path';
import { TestContainer } from './TestContainer';
import { TestCase } from './TestCase';
import { TestHeading } from './TestHeading';

const textDecoder = new TextDecoder('utf-8');

export type MarkdownTestData = TestHeading | TestCase | TestContainer;

export class TestTreeContext {
    testData = new WeakMap<vscode.TestItem, MarkdownTestData>();
    ctrl: vscode.TestController = vscode.tests.createTestController('iOSTestController', 'iOS Tests');

    getOrCreateTest(
        uri: vscode.Uri,
        provider: () => any
    ) {
        const existing = this.ctrl.items.get(uri.toString());
        if (existing) {
            return { file: existing, data: this.testData.get(existing) };
        }

        const file = this.ctrl.createTestItem(uri.toString(), uri.path.split('/').pop()!, uri);
        this.ctrl.items.add(file);

        const data = provider();
        this.testData.set(file, data);

        file.canResolveChildren = true;
        return { file, data };
    }

    addItem(item: vscode.TestItem, shouldAdd: (root: vscode.TestItem) => boolean) {
        let res = false;
        this.ctrl.items.forEach(childItem => {
            if (res) return;
            res = res || this.addItemImp(item, childItem, shouldAdd);
        })
        return res;
    }

    private addItemImp(item: vscode.TestItem, root: vscode.TestItem, shouldAdd: (root: vscode.TestItem) => boolean) {
        if (shouldAdd(root)) {
            // found
            root.children.add(item);
            return true;
        } else {
            let res = false;
            root.children.forEach(childItem => {
                if (res) return;
                res = this.addItemImp(item, childItem, shouldAdd);
            });
            return res;
        }
    }

    deleteItem(id: string) {
        this.ctrl.items.forEach(item => {
            this.deleteItemImp(id, item);
        })
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
        })
    }

    private deleteItemImp(id: string, root: vscode.TestItem) {
        if (root.id === id) {
            // found
            const parent = root.parent;
            if (parent) {
                parent.children.delete(root.id);
            } else {
                this.ctrl.items.delete(root.id);
            }
        } else {
            root.children.forEach(item => {
                this.deleteItemImp(id, item);
            })
        }
    }
}

export const getContentFromFilesystem = async (uri: vscode.Uri) => {
    try {
        const rawContent = await vscode.workspace.fs.readFile(uri);
        return textDecoder.decode(rawContent);
    } catch (e) {
        console.warn(`Error providing tests for ${uri.fsPath}`, e);
        return '';
    }
};