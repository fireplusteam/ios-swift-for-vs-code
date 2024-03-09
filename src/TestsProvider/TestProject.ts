import * as vscode from 'vscode';
import { TestTreeContext, getContentFromFilesystem } from './TestTreeContext';
import { TestContainer } from './TestContainer';
import { TestTarget } from './TestTarget';
import { getFilePathInWorkspace } from '../env';
import { FSWatcher, watch } from 'fs';
import path from 'path';

export class TestProject implements TestContainer {
    public didResolve = false;

    public context: TestTreeContext;

    public targetProvider: () => Promise<string[]>;
    public filesForTargetProvider: (target: string) => Promise<string[]>;

    private fsWatcher: FSWatcher | undefined;

    constructor(context: TestTreeContext, targetProvider: () => Promise<string[]>, filesForTargetProvider: (target: string) => Promise<string[]>) {
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

    public async updateFromContents(controller: vscode.TestController, content: string, item: vscode.TestItem) {
        const parent = { item, children: [] as vscode.TestItem[] };
        const targets = await this.targetProvider();
        const weakRef = new WeakRef(this);

        for (const target of targets) {
            const id = `${item.uri?.path || ""}/${target}`;
            const url = vscode.Uri.file(id);
            const { file, data } = this.context.getOrCreateTest(url,
                () => {
                    return new TestTarget(this.context,
                        async () => {
                            return await weakRef.deref()?.filesForTargetProvider(target) || [];
                        });
                });

            if (!data.didResolve) {
                await data.updateFromDisk(controller, file);
            }
            if ([...file.children].length > 0)
                parent.children.push(file);
            else
                this.context.deleteItem(file.id);
        }

        // watch to changes for a file, if it's changed, refresh unit tests
        this.fsWatcher?.close();
        this.fsWatcher = undefined;
        const filePath = getFilePathInWorkspace(path.join(item.uri?.path || "", item.label === "Package.swift" ? "" : "project.pbxproj"));
        this.fsWatcher = watch(filePath);
        this.fsWatcher.on("change", e => {
            setTimeout(() => {
                item.children.replace([]);
                weakRef.deref()?.updateFromDisk(controller, item);
            }, 1000);
        });

        this.didResolve = true;
        // finish
        item.children.replace(parent.children);
    }
}