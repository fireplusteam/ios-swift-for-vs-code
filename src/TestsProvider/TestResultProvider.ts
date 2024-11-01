// https://keith.github.io/xcode-man-pages/xcresulttool.1.html
// xcrun xcresulttool get test-results tests --legacy --path ./.vscode/xcode/.bundle.xcresult --format json

import * as vscode from "vscode";
import { getFilePathInWorkspace } from "../env";
import { Executor } from "../Executor";

// xcrun xcresulttool get log --legacy --path ./.vscode/xcode/.bundle.xcresult --type action

interface TestCaseResultNode {
    duration: string;
    name: string;
    nodeType: string;
    result: string;
    children?: TestCaseResultNode[];
}
interface TestCaseNode {
    result: string;
    nodeIdentifier: string;
    name: string;
    duration: string;
    children?: TestCaseResultNode[];
}

export class TestResultProvider {
    private xcresultPath: string;

    constructor(xcresultPath: string) {
        this.xcresultPath = getFilePathInWorkspace(xcresultPath);
    }

    async enumerateTestsResults(
        fileUrl: (key: string) => string,
        onTest: (
            key: string,
            result: string,
            rawMessage: string,
            message: vscode.TestMessage[],
            duration: number
        ) => void
    ) {
        const command = `xcrun xcresulttool get test-results tests --legacy --path '${this.xcresultPath}' --format json`;
        const executor = new Executor();
        const outFileCoverageStr = await executor.execShell({
            scriptOrCommand: { command: command },
        });

        await this.parse(outFileCoverageStr.stdout, fileUrl, onTest);
    }

    async parse(
        json: string,
        fileUrl: (key: string) => string,
        onTest: (
            key: string,
            result: string,
            rawMessage: string,
            message: vscode.TestMessage[],
            duration: number
        ) => void
    ) {
        const testResult = JSON.parse(json);

        const testPlans = testResult.testNodes;

        for (const testPlan of testPlans) {
            for (const target of testPlan.children) {
                const testCases = this.getAllTestItems(target);

                for (const testCase of testCases) {
                    const key = `${target.name}/${testCase.nodeIdentifier}`;
                    if (testCase.result === "Passed") {
                        onTest(key, "passed", "", [], this.convertDuration(testCase.duration));
                    } else {
                        // failed
                        const rawMessage = this.getRawMessage(testCase.children);
                        const messages = this.getMessages(
                            key,
                            undefined,
                            testCase.children,
                            fileUrl
                        );
                        const duration = this.convertDuration(testCase.duration);
                        onTest(key, "failed", rawMessage, messages, duration);
                    }
                }
            }
        }
    }

    private getRawMessage(messages: TestCaseResultNode[] | undefined, intend = "") {
        if (messages === undefined) {
            return "";
        }

        const result = messages.map((e): string => {
            if (e.nodeType === "Failure Message") {
                return intend + e.name.split("\n").join(`${intend}\n`);
            }

            const inMessages = this.getRawMessage(e.children, intend + "\t");
            const argument = e.nodeType === "Arguments" ? `Arguments:` : "";

            const message = `${intend}${argument}${e.name} -> ${e.result}`;
            if (inMessages.length > 0) {
                return `${message}\n${inMessages}`;
            } else {
                return message;
            }
        });
        return result.join("\n");
    }

    private getMessagesFromNode(
        key: string,
        node: TestCaseResultNode,
        parent: TestCaseResultNode | undefined,
        fileUrl: (key: string) => string
    ): vscode.TestMessage[] {
        const result: vscode.TestMessage[] = [];
        if (node.nodeType === "Failure Message") {
            const locationPattern = /(.*?):(\d+): ([\s\S]*)/gm;
            const matches = [...node.name.matchAll(locationPattern)];
            for (const match of matches) {
                const file = fileUrl(key);
                const fullMessage = match[3];
                const line = Number(match[2]) - 1;
                const attributes =
                    parent && parent.nodeType === "Arguments" ? parent.name : undefined;
                const diagnostic =
                    this.parseExpectationFailed(fullMessage, attributes) ||
                    new vscode.TestMessage(fullMessage);
                const range = new vscode.Position(line, 0);
                diagnostic.location = new vscode.Location(vscode.Uri.file(file), range);

                result.push(diagnostic);
            }
        } else {
            result.push(...this.getMessages(key, node, node.children, fileUrl));
        }

        return result;
    }

    private parseExpectationFailed(rawMessage: string, attributes: string | undefined) {
        try {
            const expectationPattern =
                /^(Expectation failed:) ((\((.*?→)? (.*?)\))|(.*)) == ((\((.*?→)? (.*?)\))|(.*))\)?([\s\S]*)/gm;
            const matches = [...rawMessage.matchAll(expectationPattern)];
            if (matches.length > 0) {
                const varName1 = matches[0][4];
                const varName2 = matches[0][9];
                let value1 = matches[0][5];
                if (value1 === undefined || value1.length === 0) {
                    value1 = matches[0][6];
                }
                let value2 = matches[0][10];
                if (value2 === undefined || value2.length === 0) {
                    value2 = matches[0][11];
                }

                if (value1 === undefined || value2 === undefined) {
                    return undefined;
                }

                let message = matches[0][12] || rawMessage;
                if (message.length === 0) {
                    message = rawMessage;
                }

                if (attributes) {
                    message = `Attributes: ${attributes}\n, Failed: ${message}`;
                }

                if (varName1 === undefined || varName1.length === 0) {
                    return vscode.TestMessage.diff(message, value1, value2);
                }
                if (varName2 === undefined || varName2.length === 0) {
                    return vscode.TestMessage.diff(message, value2, value1);
                }
            }
        } catch {
            /* empty */
        }
    }

    private getMessages(
        key: string,
        parent: TestCaseResultNode | undefined,
        messages: TestCaseResultNode[] | undefined,
        fileUrl: (key: string) => string
    ): vscode.TestMessage[] {
        if (messages === undefined) {
            return [];
        }

        const result: vscode.TestMessage[] = [];
        for (const message of messages) {
            result.push(...this.getMessagesFromNode(key, message, parent, fileUrl));
        }

        return result;
    }

    private convertDuration(duration: string) {
        return Number(duration.replace(",", ".").replace("s", ""));
    }

    private getAllTestItems(root: any): TestCaseNode[] {
        if (root.nodeIdentifier && root.nodeType === "Test Case") {
            return [root as TestCaseNode];
        }
        const result: TestCaseNode[] = [];
        if (root.children) {
            for (const child of root.children) {
                result.push(...this.getAllTestItems(child));
            }
        }
        return result;
    }
}
