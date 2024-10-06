import * as vscode from 'vscode';

export class TestCase {
    constructor(
        private readonly testName: String,
        private readonly suite: String,
        private readonly target: String
    ) { }

    getLabel() {
        return this.testName as string;
    }

    getXCodeBuildTest() {
        return `${this.target}/${this.suite}/${this.testName}`;
    }
}
