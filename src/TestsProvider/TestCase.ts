import * as vscode from 'vscode';

const InvalidTestCase = new Error("Invalid Test Case");

export class TestCase {
    constructor(
        private readonly testName: String | undefined,
        private readonly suite: String | undefined,
        private readonly target: String | undefined
    ) { }

    getLabel() {
        return this.testName as string;
    }

    getXCodeBuildTest() {
        if (this.target && this.testName) {
            if (this.suite)
                return `${this.target}/${this.suite}/${this.testName}`;
            else
                return `${this.target}/${this.testName}`;
        }
        throw InvalidTestCase;
    }
}
