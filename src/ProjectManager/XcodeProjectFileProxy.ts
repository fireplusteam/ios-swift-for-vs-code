import { ChildProcess, spawn } from "child_process";
import { getScriptPath } from "../env";
import { createInterface, Interface } from "readline";
import * as vscode from "vscode";
import * as fs from "fs";
import { Mutex } from "async-mutex";

export class XcodeProjectFileProxy {
    private process: ChildProcess | undefined;
    private mutex = new Mutex();
    private rl: Interface | undefined;
    private onEndRead = new vscode.EventEmitter<string[]>();
    private onEndReadWithError = new vscode.EventEmitter<any>();
    private projectPath: string;

    constructor(projectPath: string) {
        this.projectPath = projectPath;
        this.runProcess(projectPath);
    }

    private runProcess(projectPath: string) {
        this.process = spawn(`ruby '${getScriptPath("project_helper.rb")}' '${projectPath}'`, {
            shell: true,
            stdio: "pipe",
        });
        let stderr = "";
        this.process.stderr?.on("data", data => {
            stderr += data.toString();
        });
        this.process.on("exit", (code, signal) => {
            this.rl = undefined;
            console.log(
                `XcodeProjectFileProxy process exited for ${projectPath}, return code: ${code}, signal: ${signal}, error: ${stderr}`
            );
            this.onEndReadWithError.fire(
                Error(
                    `XcodeProjectFileProxy process exited for ${projectPath}, return code: ${code}, signal: ${signal}, error: ${stderr}`
                )
            );
            if (fs.existsSync(projectPath)) {
                this.runProcess(projectPath);
            }
        });
        this.read();
    }

    private async read() {
        const process = this.process;
        try {
            if (this.process?.stdout) {
                this.rl = createInterface({
                    input: this.process.stdout, //or fileStream
                    terminal: false,
                });
            }
            let result = [] as string[];
            if (this.rl === undefined) {
                throw Error(
                    `XcodeProjectFileProxy process stdout is undefined for project path: ${this.projectPath}`
                );
            }
            for await (const line of this.rl) {
                if (line === "EOF_REQUEST") {
                    this.onEndRead.fire(result);
                    result = [];
                } else {
                    result.push(line);
                }
            }
        } catch (error) {
            this.rl = undefined;
            process?.kill();
            this.onEndReadWithError.fire(error);
        }
    }

    async request(command: string): Promise<string[]> {
        const release = await this.mutex.acquire();
        try {
            let dis: vscode.Disposable | undefined;
            let disError: vscode.Disposable | undefined;
            const result = await new Promise<string[]>((resolve, reject) => {
                if (this.rl === undefined) {
                    reject(
                        Error(
                            `XcodeProjectFileProxy process stdout is undefined for project path: ${this.projectPath}`
                        )
                    );
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
