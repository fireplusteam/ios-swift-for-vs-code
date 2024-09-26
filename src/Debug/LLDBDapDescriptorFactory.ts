import * as vscode from "vscode";
import { LLDBDapOptions } from "./LLDBDapTypes";

/**
 * This class defines a factory used to find the lldb-dap binary to use
 * depending on the session configuration.
 */
export class LLDBDapDescriptorFactory
    implements vscode.DebugAdapterDescriptorFactory {
    private lldbDapOptions: LLDBDapOptions;

    constructor(lldbDapOptions: LLDBDapOptions) {
        this.lldbDapOptions = lldbDapOptions;
    }

    static async isValidDebugAdapterPath(
        pathUri: vscode.Uri,
    ): Promise<Boolean> {
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
        executable: vscode.DebugAdapterExecutable | undefined,
    ): Promise<vscode.DebugAdapterDescriptor | undefined> {
        // TODO: needs to be read from xcrun -find lldb-dap
        const path = "/Library/Developer/CommandLineTools/usr/bin/lldb-dap";
        // const path: string = executable?.command || "";

        const fileUri = vscode.Uri.file(path);
        if (!(await LLDBDapDescriptorFactory.isValidDebugAdapterPath(fileUri))) {
            LLDBDapDescriptorFactory.showLLDBDapNotFoundMessage(fileUri.path);
        }
        return this.lldbDapOptions.createDapExecutableCommand(session, executable, path);
    }

    /**
     * Shows a message box when the debug adapter's path is not found
     */
    static async showLLDBDapNotFoundMessage(path: string) {
        const openSettingsAction = "Reload VS Code";
        const callbackValue = await vscode.window.showErrorMessage(
            `Debug adapter path: ${path} is not a valid file`,
            openSettingsAction,
        );

        if (openSettingsAction === callbackValue) {
            vscode.commands.executeCommand(
                "workbench.action.reloadWindow",
            );
        }
    }
}