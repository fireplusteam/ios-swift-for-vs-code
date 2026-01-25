import * as vscode from "vscode";

export interface TestContainer {
    didResolve: Promise<boolean>;

    updateFromDisk(controller: vscode.TestController, item: vscode.TestItem): Promise<void>;

    updateFromContents(
        controller: vscode.TestController,
        content: string,
        item: vscode.TestItem
    ): Promise<void>;
}
