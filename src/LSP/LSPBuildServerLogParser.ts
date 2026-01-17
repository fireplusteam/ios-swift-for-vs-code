import { spawn } from "child_process";
import * as vscode from "vscode";
import { getLSPWorkspacePath, getXCodeBuildServerPath } from "../env";
import { LogChannelInterface } from "../Logs/LogChannel";
import { UserTerminalCloseError, UserTerminatedError } from "../CommandManagement/CommandContext";
import { ExecutorTerminated } from "../Executor";

export class BuildServerLogParser {
    private disposable: vscode.Disposable[] = [];
    private buffer: string = "";

    constructor(private log: LogChannelInterface) {}

    async startParsing(token: vscode.CancellationToken, buildPipeEvent: vscode.Event<string>) {
        // use stdin to pipe data

        this.disposable.push(
            buildPipeEvent((line: string) => {
                this.buffer += line;
            })
        );
        this.disposable.push(
            token.onCancellationRequested(() => {
                this.endParsing(UserTerminatedError);
            })
        );
    }

    async endParsing(error: any) {
        try {
            if (
                error !== UserTerminatedError &&
                error !== UserTerminalCloseError &&
                error !== ExecutorTerminated
            ) {
                return;
            }
            if (this.buffer === "") {
                // nothing to parse
                return;
            }
            const lspPath = (await getLSPWorkspacePath()).fsPath;

            // spawn build server parser process to parse compile flags to update index
            const proc = spawn(getXCodeBuildServerPath(), ["parse", "-a", "-"], {
                cwd: lspPath,
                shell: true,
                stdio: "pipe",
            });
            proc.stderr?.on("data", data => {
                this.log.debug(`BuildServerLogParser stderr: ${data.toString()}`);
            });
            proc.on("exit", (code, signal) => {
                if (code !== 0) {
                    this.log.error(
                        `BuildServerLogParser process exited with code ${code} and signal ${signal}`
                    );
                } else {
                    this.log.info(`BuildServerLogParser process exited with code ${code}`);
                }
            });

            proc.stdin?.write(this.buffer, error => {
                if (error) {
                    this.log.error(`Error writing to BuildServerLogParser stdin: ${error.message}`);
                }
                proc.stdin?.end();
            });
            this.buffer = "";
            this.disposable.forEach(d => d.dispose());
            this.disposable = [];
        } catch (error) {
            this.log.error(`Failed to spawn BuildServerLogParser process: ${String(error)}`);
        }
    }
}
