import * as vscode from 'vscode';
import { Executor } from "./execShell";
import { getEnv, getEnvFilePath, getScriptPath, getWorkspacePath } from "./env";
import { cwd } from "process";

export function checkWorkspace(executor: Executor) { 
    executor.execShellSync("Validate Environment", "check_workspace.sh");
}