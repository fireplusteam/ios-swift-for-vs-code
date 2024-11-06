import { getLSPWorkspacePath, getWorkspaceFolder } from "../env";
import { Executor } from "../Executor";
import { XCRunHelper } from "../Tools/XCRunHelper";
import { HandleProblemDiagnosticResolver } from "./lspExtension";
import * as vscode from "vscode";

export interface WorkspaceContext {
    readonly workspaceFolder: Promise<vscode.Uri>;
    readonly problemDiagnosticResolver: HandleProblemDiagnosticResolver;
    setLLDBVersion: () => Promise<void>;
}

export class WorkspaceContextImp implements WorkspaceContext {
    get workspaceFolder(): Promise<vscode.Uri> {
        return getLSPWorkspacePath();
    }
    readonly problemDiagnosticResolver: HandleProblemDiagnosticResolver;
    constructor(problemDiagnosticResolver: HandleProblemDiagnosticResolver) {
        this.problemDiagnosticResolver = problemDiagnosticResolver;
    }

    /** find LLDB version and setup path in CodeLLDB */
    async setLLDBVersion() {
        // check we are using CodeLLDB
        try {
            const libPath = await getLLDBLibPath();
            const lldbConfig = vscode.workspace.getConfiguration("lldb", getWorkspaceFolder());
            const configLLDBPath = lldbConfig.get<string>("library");
            const expressions = lldbConfig.get<string>("launch.expressions");
            if (configLLDBPath === libPath && expressions === "native") {
                return;
            }

            // show dialog for setting up LLDB
            const result = await vscode.window.showInformationMessage(
                "The Xcode extension needs to update some CodeLLDB settings to enable debugging features. Do you want to set this up in your global settings or the workspace settings?",
                "Global",
                "Workspace",
                "Cancel"
            );
            switch (result) {
                case "Global":
                    await lldbConfig.update("library", libPath, vscode.ConfigurationTarget.Global);
                    await lldbConfig.update(
                        "launch.expressions",
                        "native",
                        vscode.ConfigurationTarget.Global
                    );
                    // clear workspace setting
                    await lldbConfig.update(
                        "library",
                        undefined,
                        vscode.ConfigurationTarget.WorkspaceFolder
                    );
                    // clear workspace setting
                    await lldbConfig.update(
                        "launch.expressions",
                        undefined,
                        vscode.ConfigurationTarget.WorkspaceFolder
                    );
                    break;
                case "Workspace":
                    await lldbConfig.update(
                        "library",
                        libPath,
                        vscode.ConfigurationTarget.WorkspaceFolder
                    );
                    await lldbConfig.update(
                        "launch.expressions",
                        "native",
                        vscode.ConfigurationTarget.WorkspaceFolder
                    );
                    break;
            }
        } catch (error) {
            const errorMessage = `Error: ${error}`;
            vscode.window.showErrorMessage(
                `Failed to setup CodeLLDB for debugging of Swift code. Debugging may produce unexpected results. ${errorMessage}`
            );
            throw error;
        }
    }
}

async function getLLDBLibPath() {
    const executable = await XCRunHelper.lldbBinPath();
    const statement = `print('<!' + lldb.SBHostOS.GetLLDBPath(lldb.ePathTypeLLDBShlibDir).fullpath + '!>')`;
    const args = ["-b", "-O", `script ${statement}`];
    const result = await new Executor().execShell({
        scriptOrCommand: { command: executable },
        args: args,
    });
    if (result !== null) {
        const m = /^<!([^!]*)!>/m.exec(result.stdout);
        if (m) {
            return m[1];
        }
    }
}
