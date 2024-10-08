import { ChildProcess, SpawnOptions, spawn } from "child_process";
import * as vscode from "vscode";

// eslint-disable-next-line no-useless-escape
const testCaseRe =
    /^(Test Case\s'-\[)(.*)?\.(.*)?\s(.*)?\](.*)?(started\.)([\s\S]*?)^((Test Suite)|(Test session results)|(Test Case).*?(failed|passed).*\((.*)? .*.$)/gm;

export class TestCaseAsyncParser {
    disposable: vscode.Disposable[] = [];

    buildErrors = new Set<string>();

    constructor() {}

    private watcherProc: ChildProcess | undefined;

    async parseAsyncLogs(
        workspacePath: string,
        filePath: string,
        onMessage: (
            result: string,
            rawMessage: string,
            target: string,
            className: string,
            testName: string,
            duration: number
        ) => void
    ) {
        return new Promise<void>(resolve => {
            if (this.watcherProc !== undefined) {
                this.watcherProc.kill();
            }

            const options: SpawnOptions = {
                cwd: workspacePath,
                shell: true,
                stdio: "pipe",
            };
            const child = spawn(`tail`, ["-f", `"${filePath}"`], options);

            let stdout = "";
            const decoder = new TextDecoder("utf-8");

            child.stdout?.on("data", async data => {
                stdout += decoder.decode(data);
                let lastErrorIndex = -1;
                const matches = [...stdout.matchAll(testCaseRe)];
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
        });
    }
}
