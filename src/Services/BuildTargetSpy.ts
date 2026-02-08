import * as fs from "fs";
import { createInterface } from "readline";
import * as vscode from "vscode";
import { sleep } from "../utils";

export class BuildTargetSpy {
    private end: boolean = false;
    private outfile: fs.ReadStream | undefined;
    private onReceiveMessage: (message: string) => void = () => {};
    private isMessageSent = new Set<string>();

    constructor(private env: { [name: string]: string }) {}

    async prepare() {
        const spyOutputFile = this.env["SWBBUILD_SERVICE_PROXY_SERVER_SPY_OUTPUT_FILE"];
        fs.writeFileSync(spyOutputFile, ""); // clear spy output file before build, so we can be sure that all messages are from current build session
    }

    private async readMessages() {
        const spyOutputFile = this.env["SWBBUILD_SERVICE_PROXY_SERVER_SPY_OUTPUT_FILE"];
        // should be optimized to not read the file from the beginning every time, but since spy messages are expected to be not so often and file is expected to be small, this approach should be fine for now and is much simpler than keeping track of file pointer and re-opening file with new pointer after each message
        const outputFile = fs.createReadStream(spyOutputFile, {
            flags: "r",
            encoding: "utf-8",
            highWaterMark: 1,
            autoClose: false,
            start: 0,
            end: Number.MAX_SAFE_INTEGER,
        });
        this.outfile = outputFile;
        const rl = createInterface({
            input: outputFile,
            crlfDelay: Infinity,
            terminal: false,
        });

        try {
            for await (const line of rl) {
                if (!this.end && !this.isMessageSent.has(line)) {
                    this.isMessageSent.add(line);
                    this.onReceiveMessage(line);
                }
            }
        } finally {
            outputFile.close();
        }
    }

    async spy(cancelToken: vscode.CancellationToken, onReceiveMessage: (message: string) => void) {
        this.onReceiveMessage = onReceiveMessage;
        let disposable: vscode.Disposable | undefined = undefined;
        try {
            disposable = cancelToken.onCancellationRequested(() => {
                this.end = true;
                this.outfile?.close();
            });
            do {
                this.readMessages();
                await sleep(1000);
            } while (!this.end);
        } catch (error) {
            if (!this.end) {
                onReceiveMessage(`Spy failed: ${error}`);
            }
            throw error;
        } finally {
            disposable?.dispose();
        }
    }

    async endSpy() {
        await this.readMessages(); // read remaining messages before ending spy
        this.end = true;
        this.outfile?.close();
    }
}
