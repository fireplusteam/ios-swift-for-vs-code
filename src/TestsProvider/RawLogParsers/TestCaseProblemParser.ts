import * as path from "path";
import * as vscode from "vscode";

const problemPattern =
    /^(.*?):(\d+)(?::(\d+))?:\s+(warning|error|note):\s+([\s\S]*?)(error|warning|note):?/m;
const diffPattern = /(XCTAssertEqual|XCTAssertNotEqual)\sfailed:\s\((.*?)\).*?\((.*?)\)/m;

export class TestCaseProblemParser {
    async parseAsyncLogs(testCase: string, testItem: vscode.TestItem) {
        if (testItem.uri) {
            const problems =
                this.parseBuildLog(
                    testCase,
                    testItem.uri,
                    testItem.id.split(path.sep).at(-1) || ""
                ) || [];
            return problems;
        }
        return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private column(_output: string, _messageEnd: number) {
        return [0, 10000];
    }

    private parseBuildLog(stdout: string, uri: vscode.Uri, testName: string) {
        const files: vscode.TestMessage[] = [];
        stdout += "\nerror:";
        try {
            let startIndex = 0;
            while (startIndex < stdout.length) {
                while (startIndex > 0) {
                    // find the start of line for the next pattern search
                    if (stdout[startIndex] === "\n") {
                        break;
                    }
                    --startIndex;
                }

                const output = stdout.slice(startIndex);
                const match = output.match(problemPattern);
                if (!match) {
                    return;
                }
                const line = Number(match[2]) - 1;
                const column = this.column(output, (match?.index || 0) + match[0].length);

                let message = match[5];
                const end = message.lastIndexOf("\n");
                if (end !== -1) {
                    message = message.substring(0, end);
                }

                const expectedActualMatch = this.expectedActualValues(message);
                const fullErrorMessage = this.errorMessage(message);

                const diffName = `Diff: ${testName}`;
                let diagnostic: vscode.TestMessage;
                if (expectedActualMatch) {
                    diagnostic = vscode.TestMessage.diff(
                        fullErrorMessage,
                        expectedActualMatch.expected,
                        expectedActualMatch.actual
                    );
                } else {
                    diagnostic = new vscode.TestMessage(this.markDown(fullErrorMessage, diffName));
                }

                const range = new vscode.Range(
                    new vscode.Position(line, column[0]),
                    new vscode.Position(line, column[1])
                );

                diagnostic.location = new vscode.Location(uri, range);

                files.push(diagnostic);

                startIndex += (match.index || 0) + match[0].length;
            }
        } catch (err) {
            console.log(`TestCase parser error: ${err}`);
        }
        return files;
    }

    private expectedActualValues(message: string) {
        const expectedActualMatch = message.match(diffPattern);
        if (expectedActualMatch) {
            return { expected: expectedActualMatch[3], actual: expectedActualMatch[2] };
        }
    }

    private errorMessage(message: string) {
        const index = message.indexOf(" failed: ");
        if (index === -1) {
            const indexDelimiter = message.indexOf(" : ");
            if (indexDelimiter !== -1) {
                return message.substring(indexDelimiter + " : ".length).trim();
            }
            return message;
        }

        for (let i = index; i >= 0; --i) {
            if (message[i] === ":") {
                return message.substring(i + 1).trim();
            }
        }
        return message.substring(index).trim();
    }

    private markDown(message: string, name: string) {
        const mdString = new vscode.MarkdownString("");
        mdString.isTrusted = true;
        // replace file links to be opened
        message = message.replaceAll(/^(.*?):(\d+):/gm, (str, p1, p2) => {
            return `${str}\n\r[View line](command:vscode-ios.openFile?${encodeURIComponent(JSON.stringify([p1, p2]))})`;
        });
        if (message.includes("SnapshotTesting.diffTool")) {
            const list = message.split(/^To configure[\s\S]*?SnapshotTesting.diffTool.*"$/gm);

            for (const pattern of list) {
                const files = [...pattern.matchAll(/^@[\s\S]*?"(file:.*?)"$/gm)];
                mdString.appendMarkdown("\n" + pattern);
                if (files.length === 2) {
                    mdString.appendMarkdown(
                        `\n[Compare](command:vscode-ios.ksdiff?${encodeURIComponent(JSON.stringify([name, files[0][1], files[1][1]]))})`
                    );
                }
            }
        } else {
            mdString.appendMarkdown(message);
        }

        return mdString;
    }
}
