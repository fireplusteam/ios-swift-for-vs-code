import * as vscode from "vscode";

export class RuntimeWarningStackNode extends vscode.TreeItem {
    functionName: string;
    filePath: string;
    line: number;

    constructor(functionName: string, line: number, filePath: string) {
        super(`${functionName} + ${line}`, vscode.TreeItemCollapsibleState.None);
        this.functionName = functionName;
        this.line = line;
        this.filePath = filePath;
        this.command = {
            title: "Open location",
            command: "vscode-ios.openFile",
            arguments: [filePath, line],
        };
    }
}

export class RuntimeWarningMessageNode extends vscode.TreeItem {
    count: number;
    stack: RuntimeWarningStackNode[] = [];

    constructor(message: string, count: number, id: string) {
        let startIndex = message.lastIndexOf("] ");
        if (startIndex === -1) {
            startIndex = 0;
        } else {
            startIndex += "] ".length;
        }

        super(
            `(${count})${message.substring(startIndex)}`,
            vscode.TreeItemCollapsibleState.Collapsed
        );
        this.description = message;
        this.id = id;
        this.count = count;
    }
}

export class RuntimeWarningsDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
    readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

    warnings: RuntimeWarningMessageNode[] = [];
    used = new Map<string, RuntimeWarningMessageNode>();

    public refresh(elements: RuntimeWarningMessageNode[]): any {
        const newComingElements = new Set<string>();
        for (const elem of elements) {
            newComingElements.add(elem.id || "");
            const used = this.used.get(elem.id || "");
            if (used) {
                used.label = elem.label;
                used.count = elem.count;
                used.stack = elem.stack;
                used.description = elem.description;
            } else {
                this.warnings.push(elem);
                this.used.set(elem.id || "", elem);
            }
        }

        this.used.clear();
        this.warnings = this.warnings.filter(value => {
            return newComingElements.has(value.id || "");
        });
        this.warnings.forEach(e => {
            this.used.set(e.id || "", e);
        });

        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element) {
            if (element instanceof RuntimeWarningMessageNode) {
                return Promise.resolve(element.stack);
            }
            return Promise.resolve([]);
        } else {
            // return root elements
            return Promise.resolve(this.warnings);
        }
    }
}
