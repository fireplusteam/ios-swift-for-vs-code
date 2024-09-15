import * as vscode from 'vscode';

export class TestCase {
    constructor(
        private readonly testName: String
    ) { }

    getLabel() {
        return this.testName as string;
    }

    getXCodeBuildTest(item: vscode.TestItem) {
        const className = item.parent?.label;
        const target = item.parent?.parent?.parent?.label;
        return `${target}/${className}/${this.testName}`;
    }
}
