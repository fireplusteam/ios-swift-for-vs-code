import * as vscode from "vscode";

// eslint-disable-next-line no-useless-escape
const testCaseRe =
    /^(Test Case\s'-\[)(.*)?\.(.*)?\s(.*)?\](.*)?(started\.)([\s\S]*?)^((Test Suite)|(Test session results)|(Test Case).*?(failed|passed).*\((.*)? .*.$)/gm;

export class RawTestParser {
    stdout: string;
    watcherDisposal?: vscode.Disposable;
    constructor(stdout: string) {
        this.stdout = stdout;
    }
}
export class TestCaseAsyncParser {
    disposable: vscode.Disposable[] = [];

    buildErrors = new Set<string>();

    constructor() {}

    parseAsyncLogs(
        runPipeEvent: vscode.Event<string>,
        onMessage: (
            result: string,
            rawMessage: string,
            target: string,
            className: string,
            testName: string,
            duration: number
        ) => void
    ) {
        const rawParser = new RawTestParser("");
        rawParser.watcherDisposal = runPipeEvent(data => {
            rawParser.stdout += data;
            this.parseStdout(rawParser, onMessage);
        });
        return rawParser;
    }

    public end(rawParser: RawTestParser) {
        rawParser.watcherDisposal?.dispose();
        rawParser.watcherDisposal = undefined;
    }

    private parseStdout(
        rawParser: RawTestParser,
        onMessage: (
            result: string,
            rawMessage: string,
            target: string,
            className: string,
            testName: string,
            duration: number
        ) => void
    ) {
        let lastErrorIndex = -1;
        const matches = [...rawParser.stdout.matchAll(testCaseRe)];
        for (const match of matches) {
            const result = match[12] || "failed";
            const rawMessage = match[7];
            const target = match[2];
            const className = match[3];
            const testName = match[4];

            const duration = Number(match[13]);

            onMessage(result, rawMessage, target, className, testName, duration);
            lastErrorIndex = (match.index || 0) + match[0].length;
        }

        if (lastErrorIndex !== -1) {
            rawParser.stdout = rawParser.stdout.substring(lastErrorIndex + 1);
        }
    }
}
