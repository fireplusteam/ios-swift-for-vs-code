import path from "path";
import * as vscode from "vscode";
import fs from "fs";

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

export function updateProject(projectPath: string) {
  const relative = path.relative(getWorkspacePath(), projectPath);
  fs.mkdirSync(getVSCodePath(), { recursive: true });
  const defaultContent = `PROJECT_FILE="${relative}"`;
  fs.writeFileSync(getEnvFilePath(), defaultContent, "utf-8");
}

export function getEnv() {
  if (!fs.existsSync(getEnvFilePath())) {
    fs.mkdirSync(getVSCodePath(), { recursive: true });
    const defaultContent = 'PROJECT_FILE=""';
    fs.writeFileSync(getEnvFilePath(), defaultContent, "utf-8");
  }
  return {
    VS_IOS_PROJECT_ENV_FILE: getEnvFilePath(),
    VS_IOS_WORKSPACE_PATH: getWorkspacePath(),
    VS_IOS_SCRIPT_PATH: getScriptPath(),
    VS_IOS_XCODE_BUILD_SERVER_PATH: getXCodeBuildServerPath()
  }; // empty
}

export function getScriptPath(script: string | undefined = undefined) {
  if (script === undefined) {
    return path.join(__dirname, "..", "resources");
  }
  return path.join(__dirname, "..", "resources", script);
}

export function getXCodeBuildServerPath() {
  return path.join(__dirname, "..", "xcode-build-server"); 
}

export function getEnvList() {
  let dict: { [key: string]: string } = {};
  if (fs.existsSync(getEnvFilePath()) === false) {
    return dict;
  }
  let lines = fs.readFileSync(getEnvFilePath(), "utf-8");
  const list = lines.split("\n");
  for (let i = 0; i < list.length; ++i) {
    const line = list[i];
    const pos = line.trim().indexOf("=");
    dict[line.trim().substring(0, pos)] = line.trim().substring(pos + 1);
  }
  return dict;
}

export function isActivated() {
  const env = getEnvList();
  if (!env.hasOwnProperty("PROJECT_FILE")) {
    return false;
  }
  return true;
}
