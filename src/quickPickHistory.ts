import * as vscode from 'vscode';
import { getWorkspacePath } from './env';
import { title } from 'process';
import { QuickPickItem } from './inputPicker';

export async function quickPickWithHistory(
    items: QuickPickItem[] | string[],
    context: vscode.ExtensionContext,
    keyStorage: string,
    showPickClosure: (items: QuickPickItem[]) => Promise<QuickPickItem | undefined>
) {
    const qItems: QuickPickItem[] = items.map(e => {
        if (typeof e === 'string') {
            return { label: e, value: e };
        }
        return e;
    });
    return await quickPickWithHistoryImp(
        qItems,
        context,
        keyStorage,
        showPickClosure
    );
}

async function quickPickWithHistoryImp(
    items: QuickPickItem[],
    context: vscode.ExtensionContext,
    keyStorage: string,
    showPickClosure: (items: QuickPickItem[]) => Promise<QuickPickItem | undefined>
) {
    const key = `${keyStorage}${getWorkspacePath()}`;
    let cache = context.globalState.get<QuickPickHistory[]>(key)?.filter((e: any) => { return e.title !== undefined; });

    if (cache === undefined || cache.map((e) => { return e.title; }).sort().toString() !== items.map(v => { return v.value }).sort().toString()) {
        const oldCache = cache;
        cache = [];
        let i = 0;
        const date = Date.now();
        for (let item of items) {
            const foundIndex = oldCache?.map(e => { return e.title; }).indexOf(item.value) || -1;
            cache.push({
                title: item.value,
                order: i,
                date: foundIndex === -1 ? date : oldCache?.at(foundIndex)?.date || date
            });
            ++i;
        }
    } else {
        cache.sort((a, b) => {
            if (a.date !== b.date) {
                return b.date - a.date;
            }
            return a.order - b.order;
        });
    }
    const indexedCache = cache.map(e => { return e.title });
    const sortedItems = items.sort((a, b) => {
        return (indexedCache?.indexOf(a.value) || -1) - (indexedCache?.indexOf(b.value) || -1);
    });

    let option = await showPickClosure(sortedItems);
    if (option === undefined) {
        return undefined;
    }
    if (Array.isArray(option)) {
        for (let opt of option) {
            for (let item of cache) {
                if (item.title === opt.value) {
                    item.date = Date.now();
                }
            }
        }
    } else {
        for (let item of cache) {
            if (item.title === option.value) {
                item.date = Date.now();
            }
        }
    }
    context.globalState.update(key, cache);

    return option;
}

interface QuickPickHistory {
    title: string;
    order: number;
    date: number;
}