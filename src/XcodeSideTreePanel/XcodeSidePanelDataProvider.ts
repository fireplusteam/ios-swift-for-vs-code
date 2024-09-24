import * as vscode from "vscode";

export class XcodeSidePanelDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
    readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

    public refresh(): any {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element) {
            // return children of the element
            return Promise.resolve([]);
        } else {
            // return root elements
            return Promise.resolve([
                new vscode.TreeItem('Item 1', vscode.TreeItemCollapsibleState.Expanded),
                new vscode.TreeItem('Item 2')
            ]);
        }
    }
}