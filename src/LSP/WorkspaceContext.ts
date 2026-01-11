import { getLSPWorkspacePath, getWorkspaceFolder } from "../env";
import { Executor } from "../Executor";
import { XCRunHelper } from "../Tools/XCRunHelper";
import { HandleProblemDiagnosticResolver } from "./lspExtension";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
export interface WorkspaceContext {
    readonly workspaceFolder: Promise<vscode.Uri>;
    readonly projectFolder: Promise<vscode.Uri>;
    readonly problemDiagnosticResolver: HandleProblemDiagnosticResolver;
    setLLDBVersion: () => Promise<void>;
}

export class WorkspaceContextImp implements WorkspaceContext {
    get projectFolder(): Promise<vscode.Uri> {
        return new Promise((resolve, reject) => {
            const folder = getWorkspaceFolder();
            if (folder) {
                resolve(folder);
            } else {
                reject(new Error("Workspace folder is not found."));
            }
        });
    }
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
            if (libPath === undefined) {
                throw Error("LLDB bin framework is not found.");
            }
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
    let executable: string;
    try {
        executable = await XCRunHelper.lldbBinPath();
    } catch (error) {
        throw Error("LLDB executable is not found.");
    }
    let pathHint = await XCRunHelper.swiftToolchainPath();
    try {
        const statement = `print('<!' + lldb.SBHostOS.GetLLDBPath(lldb.ePathTypeLLDBShlibDir).fullpath + '!>')`;
        const args = ["-b", "-O", `script ${statement}`];
        const stdout = (
            await new Executor().execShell({
                scriptOrCommand: { command: executable },
                args: args,
            })
        ).stdout;

        const m = /^<!([^!]*)!>/m.exec(stdout);
        if (m) {
            pathHint = m[1];
        }
    } catch {
        /* Ignore errors and use default path hint */
    }
    const lldbPath = await findLibLLDB(pathHint);
    if (lldbPath) {
        return lldbPath;
    } else {
        throw new Error("LLDB failed to provide a library path");
    }
}

async function findLibLLDB(pathHint: string): Promise<string | undefined> {
    const stat = await fs.stat(pathHint);
    if (stat.isFile()) {
        return pathHint;
    }

    let libDir;
    let pattern;
    if (process.platform === "linux") {
        libDir = path.join(pathHint, "lib");
        pattern = /liblldb.*\.so.*/;
    } else if (process.platform === "darwin") {
        // this extension works only with macOS LLDB
        libDir = path.join(pathHint, "lib");
        pattern = /liblldb\..*dylib|LLDB/;
    } else if (process.platform === "win32") {
        libDir = path.join(pathHint, "bin");
        pattern = /liblldb\.dll/;
    } else {
        return pathHint;
    }

    for (const dir of [pathHint, libDir]) {
        const file = await findFileByPattern(dir, pattern);
        if (file) {
            return path.join(dir, file);
        }
    }
    return undefined;
}

async function findFileByPattern(path: string, pattern: RegExp): Promise<string | null> {
    try {
        const files = await fs.readdir(path);
        for (const file of files) {
            if (pattern.test(file)) {
                return file;
            }
        }
    } catch (err) {
        // Ignore missing directories and such...
    }
    return null;
}
