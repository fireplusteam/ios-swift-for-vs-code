import * as fs from "fs";
import { createInterface } from "readline";
import * as vscode from "vscode";
import { sleep } from "../utils";

function enabledSpyService() {
    const isEnabled = vscode.workspace.getConfiguration("vscode-ios").get("swb.build.service");
    if (!isEnabled) {
        return false;
    }
    return true;
}

enum BuildTargetParsingStatus {
    findGraphStart = 0,
    parsingGraph = 1,
    endGraph = 2,
}

export class BuildTargetSpy {
    private end: boolean = false;
    private outfile: fs.ReadStream | undefined;
    private onReceiveMessage: (message: string) => void = () => {};
    private isMessageSent = new Set<string>();
    private isProxyServerEnabled: boolean;

    constructor(private env: { [name: string]: string }) {
        this.isProxyServerEnabled = enabledSpyService();
    }

    async prepare() {
        if (!this.isProxyServerEnabled) {
            return;
        }
        const spyOutputFile = this.env["SWBBUILD_SERVICE_PROXY_SERVER_SPY_OUTPUT_FILE"];
        fs.writeFileSync(spyOutputFile, ""); // clear spy output file before build, so we can be sure that all messages are from current build session
    }

    private async readMessages() {
        const spyOutputFile = this.env["SWBBUILD_SERVICE_PROXY_SERVER_SPY_OUTPUT_FILE"];
        if (!this.isProxyServerEnabled || !this.isProxyServerEnabled) {
            return;
        }
        // should be optimized to not read the file from the beginning every time, but since spy messages are expected to be not so often and file is expected to be small, this approach should be fine for now and is much simpler than keeping track of file pointer and re-opening file with new pointer after each message
        const outputFile = fs.createReadStream(spyOutputFile, {
            flags: "r",
            encoding: "utf-8",
            highWaterMark: 1,
            autoClose: true,
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

    private parsingStatus = BuildTargetParsingStatus.findGraphStart;
    private parsingIndex = 0;
    private data = "";
    private bufferLines: string[] = [];
    private currentTargetId = "";
    private bufferCurrentParseLineIndx = 0;

    private parseBuildingLog() {
        for (; this.parsingIndex < this.data.length; this.parsingIndex++) {
            if (this.data[this.parsingIndex] === "\n") {
                this.bufferLines.push("");
            } else if (this.bufferLines.length > 0) {
                this.bufferLines[this.bufferLines.length - 1] += this.data[this.parsingIndex];
            }
        }
        switch (this.parsingStatus) {
            case BuildTargetParsingStatus.findGraphStart: {
                const startPattern = "ComputeTargetDependencyGraph";
                while (this.bufferCurrentParseLineIndx < this.bufferLines.length - 1) {
                    const line = this.bufferLines[this.bufferCurrentParseLineIndx];
                    this.bufferCurrentParseLineIndx++;

                    if (line.includes(startPattern)) {
                        this.parsingStatus = BuildTargetParsingStatus.parsingGraph;
                        break;
                    }
                }
                break;
            }
            case BuildTargetParsingStatus.parsingGraph: {
                while (this.bufferCurrentParseLineIndx < this.bufferLines.length - 1) {
                    const line = this.bufferLines[this.bufferCurrentParseLineIndx];
                    this.bufferCurrentParseLineIndx++;

                    if (line.trim() === "") {
                        this.parsingStatus = BuildTargetParsingStatus.endGraph;
                    } else {
                        if (line.includes("➜")) {
                            //        ➜ Explicit dependency on target 'project_lib' in project 'project_lib'
                            const explicitDependencyPattern =
                                /dependency on target '(.+?)' in project '(.+?)'/;
                            const match = line.match(explicitDependencyPattern);
                            if (match && match.length === 3) {
                                const targetName = match[1];
                                const projectName = match[2];
                                const depTargetId = `${projectName}::${targetName}`;
                                this.onReceiveMessage(
                                    `DEPENDENCY:${this.currentTargetId}|^|^|${depTargetId}`
                                );
                            }
                        } else {
                            //     Target 'SomeProject' in project 'SomeProject'
                            const targetPattern = /Target '(.+?)' in project '(.+?)'/;
                            const match = line.match(targetPattern);
                            if (match && match.length === 3) {
                                const targetName = match[1];
                                const projectName = match[2];
                                this.currentTargetId = `${projectName}::${targetName}`;
                            }
                        }
                    }
                }
                break;
            }
            case BuildTargetParsingStatus.endGraph: {
                //Ld /Users/Ievgenii_Mykhalevskyi/Library/Developer/Xcode/DerivedData/AppSuite-dnvyirekqblvknagtchyynkmewvd/Build/Products/Debug-iphonesimulator/name.app/name normal (in target 'TargetName' from project 'AppSuite')
                if (this.isProxyServerEnabled) {
                    // with proxy server we have more reliable way via SWBBuildServer
                    return;
                }
                // but if it's disabled then we can try to parse linker messages as it's the last step of build process after compilation, so all flags are got
                while (this.bufferCurrentParseLineIndx < this.bufferLines.length - 1) {
                    const line = this.bufferLines[this.bufferCurrentParseLineIndx];
                    this.bufferCurrentParseLineIndx++;

                    const linkPattern = /(^Ld).+\(in target '(.+?)' from project '(.+?)'\)/;
                    const match = line.match(linkPattern);
                    if (match && match.length === 4) {
                        const targetName = match[2];
                        const projectName = match[3];
                        const targetId = `${projectName}::${targetName}`;
                        this.onReceiveMessage(`Success_building_log_id:${targetId}`);
                    }
                }
                break;
            }
        }
    }

    async spy(
        buildPipeEvent: vscode.Event<string>,
        cancelToken: vscode.CancellationToken,
        onReceiveMessage: (message: string) => void
    ) {
        this.onReceiveMessage = onReceiveMessage;
        let cancelableDisposable: vscode.Disposable | undefined = undefined;
        let buildPipeDisposable: vscode.Disposable | undefined = undefined;
        try {
            buildPipeDisposable = buildPipeEvent(message => {
                this.data += message;
                this.parseBuildingLog();
            });
            cancelableDisposable = cancelToken.onCancellationRequested(() => {
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
            buildPipeDisposable?.dispose();
            cancelableDisposable?.dispose();
        }
    }

    async endSpy() {
        try {
            await this.readMessages(); // read remaining messages before ending spy
        } catch {
            // ignore
        }
        this.end = true;
        this.outfile?.close();
    }
}
