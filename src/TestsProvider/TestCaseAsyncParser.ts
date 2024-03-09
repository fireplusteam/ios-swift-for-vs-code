import { match } from 'assert';
import { ChildProcess, SpawnOptions, spawn } from 'child_process';
import * as vscode from 'vscode';

const testCaseRe = /^(Test Case.*started\.)([\s\S]*?)^(Test Case\s\'-\[)(.*)?\.(.*)?\s(.*)?\](.*)(failed|passed).*\((.*)? .*.$/gm

export class TestCaseAsyncParser {

    disposable: vscode.Disposable[] = [];

    buildErrors = new Set<string>();

    constructor() {
    }

    private watcherProc: ChildProcess | undefined;

    async parseAsyncLogs(
        workspacePath: string,
        filePath: string,
        onMessage: (result: string, message: vscode.TestMessage, rawMessage: string, target: string, className: string, testName: string, duration: number
        ) => any) {
        return new Promise<void>((resolve) => {
            if (this.watcherProc !== undefined) {
                this.watcherProc.kill();
            }

            const options: SpawnOptions = {
                cwd: workspacePath,
                shell: true,
                stdio: "pipe"
            }
            const child = spawn(
                `tail`,
                ["-f", `"${filePath}"`],
                options
            );

            var stdout = "";
            let decoder = new TextDecoder("utf-8");

            child.stdout?.on("data", async (data) => {
                stdout += decoder.decode(data);
                let lastErrorIndex = -1;
                const matches = [...stdout.matchAll(testCaseRe)];
                for (const match of matches) {
                    const result = match[8];
                    const rawMessage = match[2];
                    const target = match[4];
                    const className = match[5];
                    const testName = match[6];
                    const diffName = `Diff: ${testName}`;
                    const message = new vscode.TestMessage(this.markDown(rawMessage, diffName));

                    const duration = Number(match[9]);

                    onMessage(result, message, rawMessage, target, className, testName, duration);
                    lastErrorIndex = (match.index || 0) + match[0].length;
                }

                const shouldEnd = stdout.indexOf("■") !== -1;
                if (lastErrorIndex !== -1) {
                    stdout = stdout.substring(lastErrorIndex + 1);
                }
                if (shouldEnd) {
                    child.kill();
                }
            });
            child.on("exit", () => {
                if (child === this.watcherProc) {
                    this.watcherProc = undefined;
                    resolve();
                }
            });
            this.watcherProc = child;
        })
    }

    private markDown(message: string, name: string) {
        let mdString = new vscode.MarkdownString("");
        mdString.isTrusted = true;
        if (message.includes("SnapshotTesting.diffTool")) {
            const list = message.split(/^To configure[\s\S]*?SnapshotTesting.diffTool.*"$/gm);

            for (const pattern of list) {
                const files = [...pattern.matchAll(/^\@[\s\S]*?"(file:.*?)\"$/gm)];
                mdString.appendText("\n" + pattern);
                if (files.length == 2) {
                    mdString.appendMarkdown(`\n[Compare](command:vscode-ios.ksdiff?${encodeURIComponent(JSON.stringify([name, files[0][1], files[1][1]]))})`);
                }
            }
        } else {
            mdString.appendText(message);
        }

        return mdString;
    }
}