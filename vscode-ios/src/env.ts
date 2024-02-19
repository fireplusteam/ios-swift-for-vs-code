import path from 'path';
import * as vscode from 'vscode';
import fs from 'fs';

function getProjectUniqKey() {
    return `${Buffer.from(getWorkspacePath(), 'utf-8').toString('base64')}`;
}

function getTempPath() {
    return path.join("/tmp", "vscode-ios", getProjectUniqKey());
}

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