import path from "path";
import * as vscode from "vscode";
import fs from "fs";
import { Executor } from "./execShell";

export enum Platform {
    macOS,
    iOSSimulator,
    watchOSSimulator,
    visionOSSimulator,
    tvOSSimulator
};

export interface ProjectEnv {
    platform: Platform
    projectFile: string
    projectScheme: string
    projectConfiguration: string
    debugDeviceID: string
    multipleDeviceID?: string
    bundleAppName: string
    appExecutablePath: string
}

export async function getProjectEnv() {
    const exe = await getTargetExecutable();
    return {
        platform: currentPlatform(),
        projectFile: getProjectFileName(),
        projectScheme: getProjectScheme(),
        projectConfiguration: getProjectConfiguration(),
        debugDeviceID: getDeviceId(),
        multipleDeviceID: getMultiDeviceIds(),
        bundleAppName: getBundleAppName(),
        appExecutablePath: exe
    }
}

export function currentPlatform(): Platform {
    const platform = getProjectPlatform();
    switch (platform) {
        case "macOS":
            return Platform.macOS;
        case "iOS Simulator":
            return Platform.iOSSimulator;
        case "watchOS Simulator":
            return Platform.watchOSSimulator;
        case "visionOS Simulator":
            return Platform.visionOSSimulator;
        case "tvOS Simulator":
            return Platform.tvOSSimulator;
    }
    return Platform.iOSSimulator;
}

function sdk() {
    switch (currentPlatform()) {
        case Platform.iOSSimulator:
            return "iphonesimulator";
        default: // not needed
            return "";
    }
}

export function getWorkspacePath() {
    const workspace = vscode.workspace.workspaceFolders?.at(0)?.uri.fsPath || "";
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
        VS_IOS_XCODE_BUILD_SERVER_PATH: getXCodeBuildServerPath(),
        VS_IOS_XCODE_SDK: sdk()
    }; // empty
}

export function getScriptPath(script: string | undefined = undefined) {
    if (script === undefined) {
        return path.join(__dirname, "..", "resources");
    }
    return path.join(__dirname, "..", "resources", script);
}

export function getFilePathInWorkspace(fileName: string) {
    return path.join(getWorkspacePath(), fileName);
}

export function getProjectFileName() {
    return getEnvList()["PROJECT_FILE"].replace(/^"|"$/g, '');
}

export function getProjectScheme() {
    return getEnvList()["PROJECT_SCHEME"].replace(/^"|"$/g, '');
}

export function getProjectPlatform() {
    if (getEnvList().hasOwnProperty("PLATFORM"))
        return getEnvList()["PLATFORM"].replace(/^"|"$/g, '');
    return "";
}

export function getProjectConfiguration() {
    return getEnvList()["PROJECT_CONFIGURATION"].replace(/^"|"$/g, '');
}

export function getDeviceId() {
    return getEnvList()["DEVICE_ID"].replace(/^"|"$/g, '');
}

export function getMultiDeviceIds() {
    return getEnvList()["MULTIPLE_DEVICE_ID"].replace(/^"|"$/g, '');
}

export function getBundleAppName() {
    return getEnvList()["BUNDLE_APP_NAME"].replace(/^"|"$/g, '');
}

export function getProjectPath() {
    return path.join(getWorkspacePath(), getProjectFileName());
}

export function getWorkspaceId() {
    return getProjectFileName().replaceAll(path.sep, ".");
}

export function getProjectFolderPath() {
    const folder = getProjectFileName().split(path.sep).slice(0, -1).join(path.sep);
    return folder;
}

export function getXCodeBuildServerPath() {
    return path.join(__dirname, "..", "xcode-build-server");
}

export function getXCBBuildServicePath() {
    return path.join(__dirname, "..", "src", "XCBBuildServiceProxy", "dist", "XCBBuildService")
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
    if (getProjectFileName().length == 0) {
        return false;
    }
    return true;
}

export function getBuildRootPath() {
    try {
        const json = JSON.parse(fs.readFileSync(getFilePathInWorkspace("buildServer.json"), "utf-8"));
        return json.build_root;
    } catch (error) {
        console.log(`Building folder is not set : ${error}`)
        return undefined;
    }
}

function getProjectType(projectFile: string): string {
    if (projectFile.includes(".xcodeproj")) {
        return "-project";
    }
    if (projectFile.includes("Package.swift")) {
        return "-package";
    }
    return "-workspace";
}

export async function projectXcodeBuildSettings(projectFile: string, scheme: string, buildConfiguration: string) {
    const settings = await new Executor().execShell({
        cancellationToken: undefined,
        scriptOrCommand: { command: "xcodebuild" },
        args: ["-showBuildSettings", getProjectType(projectFile), projectFile, "-scheme", scheme, "-configuration", buildConfiguration, "-json"]
    });
    return JSON.parse(settings.stdout);
}

export async function getProductName() {
    const scheme = getProjectScheme();
    const projectFile = getProjectFileName();
    const projectSettings: any[] = await projectXcodeBuildSettings(projectFile, scheme, getProjectConfiguration());

    return projectSettings[0].buildSettings.PRODUCT_NAME;
}

export async function getTargetExecutable() {
    const product_name = await getProductName();
    const build_path = getBuildRootPath();
    const build_configuration = getProjectConfiguration();
    switch (currentPlatform()) {
        case Platform.macOS:
            return `${build_path}/Build/Products/${build_configuration}/${product_name}.app`
        case Platform.watchOSSimulator:
            return `${build_path}/Build/Products/${build_configuration}-watchsimulator/${product_name}.app`
        case Platform.visionOSSimulator:
            return `${build_path}/Build/Products/${build_configuration}-xrsimulator/${product_name}.app`
        case Platform.tvOSSimulator:
            return `${build_path}/Build/Products/${build_configuration}-appletvsimulator/${product_name}.app`
        case Platform.iOSSimulator:
            return `${build_path}/Build/Products/${build_configuration}-iphonesimulator/${product_name}.app`
    }
}