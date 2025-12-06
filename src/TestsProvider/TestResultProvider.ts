// https://keith.github.io/xcode-man-pages/xcresulttool.1.html
// xcrun xcresulttool get test-results tests --legacy --path ./.vscode/xcode/.bundle.xcresult --format json

import * as vscode from "vscode";
import { getFilePathInWorkspace } from "../env";
import { Executor } from "../Executor";
import { BundlePath } from "../CommandManagement/BundlePath";

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
    private xcresultPath(bundle: BundlePath) {
        return getFilePathInWorkspace(bundle.bundleResultPath());
    }
    async enumerateTestsResults(
        fileUrl: (key: string) => string,
        bundle: BundlePath,
        onTest: (
            key: string,
            result: string,
            rawMessage: string,
            message: vscode.TestMessage[],
            duration: number
        ) => void
    ) {
        const command = `xcrun xcresulttool get test-results tests --legacy --path '${this.xcresultPath(bundle)}' --format json`;
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

    substringBetweenParentheses(rawMessage: string) {
        rawMessage += " "; // add space to help with parsing
        const stack: number[] = [];
        let lastCloseParenIndex = -2;
        let startOpenParentIndex = -2;
        const openCharacters = "({[\"'";
        const closeCharacters = ")}]\"'";
        let isInParens = true;
        for (let i = 0; i < rawMessage.length; i++) {
            if (stack.length > 0 && "\"'".indexOf(rawMessage[stack.at(-1) || 0]) !== -1) {
                // skip until we find the same closing quote
                if (rawMessage[i] === "\\" && rawMessage[i + 1] === rawMessage[stack.at(-1) || 0]) {
                    i += 2; // \" or \'
                    continue;
                }
                if (rawMessage[i] === rawMessage[stack.at(-1) || 0]) {
                    lastCloseParenIndex = i;
                    lastCloseParenIndex += isInParens === false ? 1 : 0;
                    stack.pop();
                }
            } else if (openCharacters.indexOf(rawMessage[i]) !== -1) {
                if (startOpenParentIndex === -2) {
                    startOpenParentIndex = i;
                    if (rawMessage[i] !== "(") {
                        startOpenParentIndex--;
                        isInParens = false;
                    }
                }
                stack.push(i);
            } else if (closeCharacters.indexOf(rawMessage[i]) !== -1) {
                lastCloseParenIndex = i;
                lastCloseParenIndex += isInParens === false ? 1 : 0;
                stack.pop();
            }
            if (stack.length === 0 && /\s/.test(rawMessage[i])) {
                // found the main ==
                if (lastCloseParenIndex === -2) {
                    lastCloseParenIndex = i;
                }
                break;
            } else if (stack.length === 0 && /\s/.test(rawMessage[i]) === false) {
                if (startOpenParentIndex === -2) {
                    startOpenParentIndex = i - 1;
                    isInParens = false;
                }
            }
        }
        if (startOpenParentIndex !== -2 && lastCloseParenIndex !== -2) {
            return {
                rawMessage: rawMessage.substring(startOpenParentIndex + 1, lastCloseParenIndex),
                lastCloseParenIndex,
            };
        }
        if (lastCloseParenIndex !== -2) {
            return {
                rawMessage: rawMessage.substring(0, lastCloseParenIndex),
                lastCloseParenIndex,
            };
        }
        if (startOpenParentIndex !== -2) {
            return {
                rawMessage: rawMessage.substring(startOpenParentIndex + 1),
                lastCloseParenIndex: -2,
            };
        }
        return { rawMessage: undefined, lastCloseParenIndex: -2 };
    }

    private parseExpectationFailed(rawMessage: string, attributes: string | undefined) {
        try {
            /// Expectation failed: (value → 5) == (expected → 10)
            /// Expectation failed: 5 == (expected → 10)
            /// Expectation failed: (value → 5) == 10
            /// Expectation failed: 5 == 10
            if (!rawMessage.startsWith("Expectation failed:")) {
                return undefined;
            }
            const originalRawMessage = rawMessage;
            rawMessage = rawMessage.trimStart().replace(/^Expectation failed:\s+/, "");

            const { rawMessage: leftExpression, lastCloseParenIndex: leftIndex } =
                this.substringBetweenParentheses(rawMessage.trimStart());
            if (leftExpression === undefined) {
                return undefined;
            }
            let rightRawMessage = rawMessage.substring(leftIndex).trimStart();
            const delimiterIndex = rightRawMessage.indexOf("==");
            if (delimiterIndex === -1) {
                return undefined;
            }
            rightRawMessage = rightRawMessage.substring(delimiterIndex + 2).trimStart();
            if (rightRawMessage.length === 0) {
                return undefined;
            }
            const { rawMessage: rightExpression, lastCloseParenIndex: rightIndex } =
                this.substringBetweenParentheses(rightRawMessage);
            if (rightExpression === undefined) {
                return undefined;
            }
            // console.log(`Left: ${leftExpression}, Right: ${rightExpression}`);
            const leftMatched = [...leftExpression.matchAll(/(.*?→\s?)?(.*)/gm)];
            const rightMatched = [...rightExpression.matchAll(/(.*?→\s?)?(.*)/gm)];
            if (leftMatched.length === 0 || rightMatched.length === 0) {
                return undefined;
            }
            const varName1 = leftMatched[0][1]?.trim();
            const value1 = leftMatched[0][2]?.trim();
            const varName2 = rightMatched[0][1]?.trim();
            const value2 = rightMatched[0][2]?.trim();
            let message = originalRawMessage;
            if (rightIndex !== -1) {
                message = rightRawMessage.substring(rightIndex + 1).trim();
                if (message.length === 0) {
                    message = originalRawMessage;
                }
            }

            if (attributes) {
                message = `Attributes: ${attributes},\n Failed: ${message}`;
            }
            // console.log(
            //     `Var1: ${varName1}, Value1: ${value1}, Var2: ${varName2}, Value2: ${value2}, message: ${message}`
            // );
            if (varName1 === undefined || varName1.length === 0) {
                return vscode.TestMessage.diff(message, value1, value2);
            }
            if (varName2 === undefined || varName2.length === 0) {
                return vscode.TestMessage.diff(message, value2, value1);
            }
            return vscode.TestMessage.diff(message, value1, value2);
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
        if (duration === null || duration === undefined || duration.length === 0) {
            return Number(0);
        }
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
