import * as vscode from 'vscode';
import { Executor } from "./execShell";
import { getEnv, getEnvFilePath, getScriptPath, getWorkspacePath } from "./env";

export function cleanDerivedData(executor: Executor) { 
    executor.execShellSync("Clean Derived Data", "clean_derived_data.sh");
}