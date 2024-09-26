import * as vscode from "vscode";
import { LLDBDapOptions } from "./LLDBDapTypes";

/**
 * This creates the configurations for this project if used as a standalone
 * extension.
 */
export function createDefaultLLDBDapOptions(): LLDBDapOptions {
    return {
        debuggerType: "xcode-lldb",
        async createDapExecutableCommand(
            session: vscode.DebugSession,
            packageJSONExecutable: vscode.DebugAdapterExecutable | undefined,
            path: string
        ): Promise<vscode.DebugAdapterExecutable | undefined> {
            const config = vscode.workspace.getConfiguration(
                "vscode-ios",
                session.workspaceFolder,
            );
            const log_path = null;

            let env: { [key: string]: string } = {};
            if (log_path) {
                env["LLDBDAP_LOG"] = log_path;
            }
            // const configEnvironment = config.get<{ [key: string]: string }>("lldb.environment") || {};
            if (path) {
                const dbgOptions = {
                    env: {
                        // ...configEnvironment,
                        ...env,
                    }
                };
                return new vscode.DebugAdapterExecutable(path, [], dbgOptions);
            } else if (packageJSONExecutable) {
                return new vscode.DebugAdapterExecutable(
                    packageJSONExecutable.command,
                    packageJSONExecutable.args,
                    {
                        ...packageJSONExecutable.options,
                        env: {
                            ...packageJSONExecutable.options?.env,
                            // ...configEnvironment,
                            ...env,
                        },
                    },
                );
            } else {
                return undefined;
            }
        },
    };
}