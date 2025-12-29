import * as path from "path";
import * as vscode from "vscode";
import { LogChannelInterface } from "../../Logs/LogChannel";

const problemPattern =
    /^(.*?):(\d+)(?::(\d+))?:\s+(warning|error|note):\s+([\s\S]*?)^(.*?):(\d+)(?::(\d+))?:\s+(warning|error|note):\s/m;
const diffPattern = /(XCTAssertEqual|XCTAssertNotEqual)\sfailed:\s\((.*?)\).*?\((.*?)\)/m;

export class TestCaseProblemParser {
    constructor(private readonly log: LogChannelInterface) {}

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
        stdout += "\n/path/random_ending_path_3456246/Tests.swift:36: error: ";
        try {
            let startIndex = 0;
            while (startIndex < stdout.length) {
                const output = stdout.slice(startIndex);
                const match = output.match(problemPattern);
                if (!match) {
                    break;
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

                if (message.length === 0) {
                    startIndex += (match.index || startIndex) + match[0].length;
                } else {
                    startIndex +=
                        (match.index || startIndex) +
                        match[0].lastIndexOf(message) +
                        message.length;
                }
            }
        } catch (err) {
            this.log.error(`TestCase parser error: ${err}`);
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
        // replace file links to be opened

        message = message.replaceAll(
            // eslint-disable-next-line no-useless-escape
            /^(@\−)[\s\S]*?"(file:.*?)"$[\s\S]*^(@\+)[\s\S]*?"(file:.*?)"$/gm,
            (str, g1, g2, g3, g4) => {
                return `\n[Compare](command:vscode-ios.ksdiff?${encodeURIComponent(JSON.stringify([name, g2, g4]))})`;
            }
        );
        message = message.replaceAll(/^(.*?):(\d+)/gm, (str, p1, p2) => {
            return `${str}\n\r[View line](command:vscode-ios.openFile?${encodeURIComponent(JSON.stringify([p1, p2]))})`;
        });
        const mdString = new vscode.MarkdownString(message);
        mdString.isTrusted = true;
        return mdString;
    }
}
