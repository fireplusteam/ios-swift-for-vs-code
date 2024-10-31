import * as vscode from "vscode";
import { XCRunHelper } from "../Tools/XCRunHelper";
import { getWorkspaceFolder } from "../env";

function useLLDB_DAP() {
    const isEnabled = vscode.workspace
        .getConfiguration("vscode-ios", getWorkspaceFolder())
        .get("debug.lldb-dap");
    if (!isEnabled) {
        return false;
    }
    return true;
}

/**
 * This class defines a factory used to find the lldb-dap binary to use
 * depending on the session configuration.
 */
export class LLDBDapDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    constructor() {}

    static async isValidDebugAdapterPath(pathUri: vscode.Uri): Promise<boolean> {
        try {
            const fileStats = await vscode.workspace.fs.stat(pathUri);
            if (!(fileStats.type & vscode.FileType.File)) {
                return false;
            }
        } catch (err) {
            return false;
        }
        return true;
    }

    async createDebugAdapterDescriptor(
        session: vscode.DebugSession,
        executable: vscode.DebugAdapterExecutable | undefined
    ): Promise<vscode.DebugAdapterDescriptor | undefined> {
        if (session.configuration.isDummy === true) {
            // dummy session
            return new vscode.DebugAdapterExecutable("", []);
        }
        const path = await LLDBDapDescriptorFactory.getXcodeDebuggerExePath();
        if (path === null) {
            LLDBDapDescriptorFactory.showLLDBDapNotFoundMessage();
            return undefined;
        }

        const log_path = session.configuration.logPath + ".lldb";
        const env: { [key: string]: string } = {};
        if (log_path) {
            // Uncomment it for Debug purposes
            // env["LLDBDAP_LOG"] = getFilePathInWorkspace(log_path);
        }

        // const configEnvironment = config.get<{ [key: string]: string }>("lldb.environment") || {};
        if (path) {
            const dbgOptions = {
                env: {
                    // ...configEnvironment,
                    ...env,
                },
            };
            return new vscode.DebugAdapterExecutable(path, [], dbgOptions);
        } else if (executable) {
            return new vscode.DebugAdapterExecutable(executable.command, executable.args, {
                ...executable.options,
                env: {
                    ...executable.options?.env,
                    // ...configEnvironment,
                    ...env,
                },
            });
        } else {
            return undefined;
        }
    }

    static async getXcodeDebuggerExePath() {
        try {
            const path = await XCRunHelper.getLLDBDapPath();
            const fileUri = vscode.Uri.file(path);
            const majorSwiftVersion = Number((await XCRunHelper.swiftToolchainVersion())[0]);
            // starting swift 6, lldb-dap is included in swift toolchain, so use is
            if (
                majorSwiftVersion >= 6 &&
                useLLDB_DAP() &&
                (await LLDBDapDescriptorFactory.isValidDebugAdapterPath(fileUri))
            ) {
                return path;
            }
            return null;
        } catch {
            return null;
        }
    }
    /**
     * Shows a message box when the debug adapter's path is not found
     */
    static async showLLDBDapNotFoundMessage() {
        const openSettingsAction = "Reload VS Code";
        const callbackValue = await vscode.window.showErrorMessage(
            `Xcode Debug adapter is not valid. Please make sure that Xcode is installed and restart VS Code!`,
            openSettingsAction
        );

        if (openSettingsAction === callbackValue) {
            vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
    }
}
