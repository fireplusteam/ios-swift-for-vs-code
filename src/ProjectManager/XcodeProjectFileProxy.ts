import fs from "fs";
import { ChildProcess, spawn } from "child_process";
import { getScriptPath } from "../env";
import { createInterface, Interface } from "readline";
import * as vscode from "vscode";

export class XcodeProjectFileProxy {
    private process: ChildProcess | undefined;
    private commandQueue: Promise<string[]> | undefined;
    private rl: Interface | undefined;
    private onEndRead = new vscode.EventEmitter<string[]>();
    private onEndReadWithError = new vscode.EventEmitter<any>();

    constructor(projectPath: string) {
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
            console.log(`Return code: ${code}, signal: ${signal}, error: ${stderr}`);
            this.onEndReadWithError.fire(Error(`${projectPath} file failed: ${stderr}`));
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
                throw Error("Stream is undefined");
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
        if (this.commandQueue === undefined) {
            let dis: vscode.Disposable | undefined;
            let disError: vscode.Disposable | undefined;
            this.commandQueue = new Promise<string[]>((resolve, reject) => {
                if (this.rl === undefined) {
                    reject(Error("Process is killed"));
                }
                dis = this.onEndRead.event(e => {
                    dis?.dispose();
                    this.commandQueue = undefined;
                    resolve(e);
                });
                disError = this.onEndReadWithError.event(e => {
                    disError?.dispose();
                    this.commandQueue = undefined;
                    reject(e);
                });
                if (this.process?.stdin?.writable) {
                    this.process.stdin.write(`${command}\n`);
                    this.process.stdin.uncork();
                }
            });
            return await this.commandQueue;
        } else {
            const wait = this.commandQueue;
            await wait;
            return await this.request(command);
        }
    }
}
