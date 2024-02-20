import path from 'path';
import * as vscode from 'vscode';
import fs from 'fs';

export function getWorkspacePath() {
    const workspace = vscode.workspace.rootPath || "";
    return workspace; 
}

export function getVSCodePath() {
    return path.join(getWorkspacePath(), ".vscode");
}

export function getEnvFilePath() { 
    return path.join(getVSCodePath(), ".env");
}

export function getEnv() {
    if (!fs.existsSync(getEnvFilePath())) {
        fs.mkdirSync(getVSCodePath(), { recursive: true });
        const defaultContent = 'PROJECT_FILE=""';
        fs.writeFileSync(getEnvFilePath(), defaultContent, "utf-8");
    }
    return {
        "VS_IOS_PROJECT_ENV_FILE": getEnvFilePath(),
        "VS_IOS_WORKSPACE_PATH": getWorkspacePath(),
        "VS_IOS_SCRIPT_PATH": getScriptPath()
    }; // empty
}

export function getScriptPath(script: string | undefined = undefined) {
    if (script === undefined) {
        return path.join(__dirname, "..", "resources");
    }
    return path.join(__dirname, "..", "resources", script);
}

export function getEnvList() {
    let dict: { [key: string]: string } = {};
    let lines = fs.readFileSync(getEnvFilePath(), "utf-8");
    const list = lines.split("\n");
    for (let i = 0; i < list.length;++i) {
        const line = list[i];
        const pos = line.trim().indexOf("=");
        dict[line.trim().substring(0, pos)] = line.trim().substring(pos + 1);
    }
    return dict;
}