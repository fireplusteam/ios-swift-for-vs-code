import path from "path";
import * as vscode from "vscode";
import fs from "fs";
import { emptyLog } from "./utils";
import { XCodeSettings } from "./Services/ProjectSettingsProvider";

export enum Platform {
    macOS,
    iOSSimulator,
    watchOSSimulator,
    visionOSSimulator,
    tvOSSimulator
};

export const ProjectFileMissedError = new Error("Project File is not set in .vscode/.env file. Please select project or workspace Xcode file");
export const ProjectSchemeMissedError = new Error("Project scheme is not set in .vscode/.env file. Please run the command to select it!");
export const ProjectConfigurationMissedError = new Error("Project configuration is not set in .vscode/.env. Please run the command to select it");
export const DebugDeviceIDMissedError = new Error("DebugDeviceIDMissedError");
export const MultipleDeviceMissedError = new Error("MultipleDeviceMissedError");
export const BundleAppNameMissedError = new Error("BundleAppNameMissedError");
export const AppExecutablePathMissedError = new Error("AppExecutablePathMissedError");
export const PlatformMissedError = new Error("PlatformMissedError");
export const AppTargetExecutableMissedError = new Error("AppTargetExecutableMissedError");
export const ProductNameMissedError = new Error("ProductNameMissedError");

export interface ProjectEnvInterface {
    platform: Promise<Platform>
    platformString: Promise<String>
    projectFile: Promise<string>
    projectScheme: Promise<string>
    projectConfiguration: Promise<string>
    debugDeviceID: Promise<string>
    multipleDeviceID: Promise<string>
    bundleAppName: Promise<string>
    appExecutablePath: Promise<string>
    projectType: Promise<"-workspace" | "-project" | "-package">
    productName: Promise<string>
}

export interface SetProjectEnvInterface {
    setProjectFile(file: string): Promise<void>
    setProjectScheme(scheme: string): Promise<void>
    setProjectConfiguration(configuration: string): Promise<void>
    setDebugDeviceID(deviceID: string): Promise<void>
    setMultipleDeviceID(multiId: string): Promise<void>
    setPlatform(platform: string): Promise<void>
}

export const ProjectEnvFilePath = ".vscode/.env";

export class ProjectEnv implements ProjectEnvInterface, SetProjectEnvInterface {
    private settingsProvider: XCodeSettings;

    constructor(settings: XCodeSettings) {
        this.settingsProvider = settings;
    }

    get productName(): Promise<string> {
        return this.settingsProvider.settings.then((projectSettings: any) => {
            try {
                return projectSettings[0].buildSettings.PRODUCT_NAME;
            } catch {
                throw ProductNameMissedError;
            }
        });
    }

    get platform(): Promise<Platform> {
        return currentPlatform();
    }

    get platformString(): Promise<String> {
        return getProjectPlatform();
    }

    get projectFile(): Promise<string> {
        return getProjectFileName().then(projectFile => {
            if (!fs.existsSync(getFilePathInWorkspace(projectFile))) {
                this.emptySessions();
                return Promise.reject(ProjectFileMissedError);
            }
            return projectFile;
        });
    }

    get projectScheme(): Promise<string> {
        return getProjectScheme();
    }
    get projectConfiguration(): Promise<string> {
        return getProjectConfiguration();
    }
    get debugDeviceID(): Promise<string> {
        return getDeviceId();
    }
    get multipleDeviceID(): Promise<string> {
        return getMultiDeviceIds();
    }
    get bundleAppName(): Promise<string> {
        return this.settingsProvider.settings.then((projectSettings: any) => {
            try {
                return projectSettings[0].buildSettings.PRODUCT_BUNDLE_IDENTIFIER;
            } catch {
                throw BundleAppNameMissedError;
            }
        });
    }
    get appExecutablePath(): Promise<string> {
        return this.productName.then(productName => {
            return this.projectConfiguration.then(configuration => {
                return getTargetExecutable(productName, configuration);
            });
        });
    }

    get projectType(): Promise<"-workspace" | "-project" | "-package"> {
        return this.projectFile.then((value) => {
            return getProjectType(value);
        });
    }

    async setProjectFile(file: string): Promise<void> {
        saveKeyToEnvList("PROJECT_FILE", file);
    }
    async setProjectScheme(scheme: string): Promise<void> {
        saveKeyToEnvList("PROJECT_SCHEME", scheme);
    }
    async setProjectConfiguration(configuration: string): Promise<void> {
        saveKeyToEnvList("PROJECT_CONFIGURATION", configuration);
    }
    async setDebugDeviceID(deviceID: string): Promise<void> {
        saveKeyToEnvList("DEVICE_ID", deviceID);
    }
    async setMultipleDeviceID(multiId: string): Promise<void> {
        saveKeyToEnvList("MULTIPLE_DEVICE_ID", multiId);
    }
    async setPlatform(platform: string): Promise<void> {
        saveKeyToEnvList("PLATFORM", platform);
    }

    async emptySessions() {
        emptyLog(ProjectEnvFilePath);
    }
}

export async function currentPlatform() {
    const platform = await getProjectPlatform();
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

async function sdk() {
    switch (await currentPlatform()) {
        case Platform.iOSSimulator:
            return "iphonesimulator";
        default: // not needed
            return "";
    }
}

export function getWorkspaceFolder() {
    const workspace = vscode.workspace.workspaceFolders?.at(0)?.uri;
    return workspace;
}

export function getWorkspacePath() {
    const workspace = getWorkspaceFolder()?.fsPath || "";
    return workspace;
}

export function getVSCodePath() {
    return path.join(getWorkspacePath(), ".vscode");
}

export function getEnvFilePath() {
    return path.join(getVSCodePath(), ".env");
}

export async function updateProject(projectEvn: ProjectEnv, projectPath: string) {
    const relative = path.relative(getWorkspacePath(), projectPath);
    fs.mkdirSync(getVSCodePath(), { recursive: true });
    await projectEvn.setProjectFile(relative);
}

export async function getEnv() {
    if (!fs.existsSync(getEnvFilePath())) {
        fs.mkdirSync(getVSCodePath(), { recursive: true });
        const defaultContent = 'PROJECT_FILE=""';
        fs.writeFileSync(getEnvFilePath(), defaultContent, "utf-8");
    }
    let xcodeSdk: string;
    try {
        xcodeSdk = await sdk();
    } catch {
        xcodeSdk = ""
    }
    return {
        VS_IOS_PROJECT_ENV_FILE: getEnvFilePath(),
        VS_IOS_WORKSPACE_PATH: getWorkspacePath(),
        VS_IOS_SCRIPT_PATH: getScriptPath(),
        VS_IOS_XCODE_SDK: xcodeSdk
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

export async function getProjectFileName() {
    try {
        return (getEnvList())["PROJECT_FILE"].replace(/^"|"$/g, '');
    } catch {
        throw ProjectFileMissedError;
    }
}

export async function getProjectScheme() {
    try {
        return (getEnvList())["PROJECT_SCHEME"].replace(/^"|"$/g, '');
    }
    catch {
        throw ProjectSchemeMissedError;
    }
}

export async function getProjectPlatform() {
    try {
        return (getEnvList())["PLATFORM"].replace(/^"|"$/g, '');
    } catch {
        throw PlatformMissedError;
    }
}

export async function getProjectConfiguration() {
    try {
        return (getEnvList())["PROJECT_CONFIGURATION"].replace(/^"|"$/g, '');
    } catch {
        throw ProjectConfigurationMissedError;
    }
}

export async function getDeviceId() {
    try {
        return (getEnvList())["DEVICE_ID"].replace(/^"|"$/g, '');
    } catch {
        throw DebugDeviceIDMissedError;
    }
}

export async function getMultiDeviceIds() {
    try {
        return (getEnvList())["MULTIPLE_DEVICE_ID"].replace(/^"|"$/g, '');
    } catch {
        throw MultipleDeviceMissedError;
    }
}

export async function getProjectPath() {
    return path.join(getWorkspacePath(), await getProjectFileName());
}

export async function getWorkspaceId() {
    return (await getProjectFileName()).replaceAll(path.sep, ".");
}

export async function getProjectFolderPath() {
    const folder = (await getProjectFileName()).split(path.sep).slice(0, -1).join(path.sep);
    return folder;
}

export function getXCodeBuildServerPath() {
    return path.join(__dirname, "..", "xcode-build-server", "xcode-build-server");
}

export function getXCBBuildServicePath() {
    return path.join(__dirname, "..", "src", "XCBBuildServiceProxy", "dist", "XCBBuildService")
}

function readEnvFileToDict() {
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

export function getEnvList() {
    return readEnvFileToDict();
}

export function saveKeyToEnvList(key: string, value: string) {
    const dict = readEnvFileToDict();
    dict[key] = `"${value}"`;

    let json = "";
    for (const [key, val] of Object.entries(dict)) {
        if (key === "" || val === "")
            continue;
        json += `${key}=${val}\n`
    }

    fs.writeFileSync(getEnvFilePath(), json, "utf-8");
}

export async function isActivated() {
    const env = getEnvList();
    if (!env.hasOwnProperty("PROJECT_FILE")) {
        return false;
    }
    if ((await getProjectFileName()).length == 0) {
        return false;
    }
    return true;
}

function getBuildServerJson() {
    return JSON.parse(fs.readFileSync(getFilePathInWorkspace("buildServer.json"), "utf-8"));
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

export async function isBuildServerValid() {
    try {
        const buildServer = getBuildServerJson();
        if (buildServer.workspace.indexOf(getFilePathInWorkspace(await getProjectFileName())) == -1) {
            return false;
        }
        if (await getProjectScheme() !== buildServer.scheme) {
            return false;
        }
        let isValid = false;
        for (const arg of buildServer.argv) {
            const path = getXCodeBuildServerPath();
            if (path === arg) {
                isValid = true;
            }
        }
        if (!isValid) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

export function getProjectType(projectFile: string) {
    if (projectFile.includes(".xcodeproj")) {
        return "-project";
    }
    if (projectFile.includes("Package.swift")) {
        return "-package";
    }
    return "-workspace";
}

export async function getTargetExecutable(product_name: string, build_configuration: string) {
    try {
        // if get_project_type(list["PROJECT_FILE"]) == "-package":
        //     return "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/Library/Xcode/Agents/xctest"
        const build_path = getBuildRootPath();
        switch (await currentPlatform()) {
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
    catch {
        throw AppTargetExecutableMissedError;
    }
}