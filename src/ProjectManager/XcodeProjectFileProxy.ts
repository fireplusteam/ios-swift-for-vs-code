import { ChildProcess, spawn } from "child_process";
import { getScriptPath } from "../env";
import { createInterface, Interface } from "readline";
import * as vscode from "vscode";
import { Mutex } from "async-mutex";
import { LogChannelInterface } from "../Logs/LogChannel";

export class XcodeProjectFileProxy {
    private process: ChildProcess | undefined;
    private mutex = new Mutex();
    private rl: Interface | undefined;
    private onEndRead = new vscode.EventEmitter<string[]>();
    private onEndReadWithError = new vscode.EventEmitter<any>();

    constructor(private log: LogChannelInterface) {
        this.runProcess();
    }

    private runProcess() {
        this.process = spawn(`ruby '${getScriptPath("project_helper.rb")}'`, {
            shell: true,
            stdio: "pipe",
            env: {
                ...process.env,
            },
        });
        let stderr = "";
        this.process.stderr?.on("data", data => {
            stderr += data.toString();
        });
        this.process.on("exit", (code, signal) => {
            this.rl = undefined;
            this.log.debug(
                `XcodeProjectFileProxy process exited, return code: ${code}, signal: ${signal}, error: ${stderr}`
            );
            this.onEndReadWithError.fire(
                Error(
                    `XcodeProjectFileProxy process exited, return code: ${code}, signal: ${signal}, error: ${stderr}`
                )
            );
            this.runProcess();
        });
        this.read();
    }

    private async read() {
        const process = this.process;
        const handleError = (error: any) => {
            this.rl = undefined;
            process?.kill();
            this.log.error(`Error in XcodeProjectFileProxy for project path: ${String(error)}`);
            this.onEndReadWithError.fire(error);
        };
        try {
            if (this.process?.stdout) {
                this.rl = createInterface({
                    input: this.process.stdout, //or fileStream
                    terminal: false,
                });
            }
            let result = [] as string[];
            if (this.rl === undefined) {
                throw Error(`XcodeProjectFileProxy process stdout is undefined`);
            }
            this.rl.on("line", line => {
                if (line === "ERROR_REQUEST_error") {
                    this.onEndReadWithError.fire(new Error(result.join("\n")));
                    result = [];
                } else if (line === "EOF_REQUEST") {
                    this.onEndRead.fire(result);
                    result = [];
                } else {
                    result.push(line);
                }
            });
            this.rl.on("error", error => handleError(error));
        } catch (error) {
            handleError(error);
        }
    }

    async request(command: string): Promise<string[]> {
        const release = await this.mutex.acquire();
        try {
            let dis: vscode.Disposable | undefined;
            let disError: vscode.Disposable | undefined;
            const result = await new Promise<string[]>((resolve, reject) => {
                if (this.rl === undefined) {
                    reject(Error(`XcodeProjectFileProxy process stdout is undefined`));
                }
                dis = this.onEndRead.event(e => {
                    dis?.dispose();
                    resolve(e);
                });
                disError = this.onEndReadWithError.event(e => {
                    disError?.dispose();
                    reject(e);
                });
                if (this.process?.stdin?.writable) {
                    this.process.stdin.write(`${command}\n`);
                    this.process.stdin.uncork();
                }
            });
            return result;
        } finally {
            release();
        }
    }
}
