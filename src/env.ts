import path from "path";
import * as vscode from "vscode";
import fs from "fs";
import { Executor } from "./execShell";
import { lock } from "lockfile";
import { asyncLock } from "./utils";

export enum Platform {
    macOS,
    iOSSimulator,
    watchOSSimulator,
    visionOSSimulator,
    tvOSSimulator
};

export const ProjectFileMissedError = new Error("ProjectFileMissedError");
export const ProjectSchemeMissedError = new Error("ProjectSchemeMissedError");
export const ProjectConfigurationMissedError = new Error("ProjectConfigurationMissedError");
export const DebugDeviceIDMissedError = new Error("DebugDeviceIDMissedError");
export const MultipleDeviceMissedError = new Error("MultipleDeviceMissedError");
export const BundleAppNameMissedError = new Error("BundleAppNameMissedError");
export const AppExecutablePathMissedError = new Error("AppExecutablePathMissedError");
export const PlatformMissedError = new Error("PlatformMissedError");
export const AppTargetExecutableMissedError = new Error("AppTargetExecutableMissedError");

export interface ProjectEnvInterface {
    platform: Promise<Platform>
    projectFile: Promise<string>
    projectScheme: Promise<string>
    projectConfiguration: Promise<string>
    debugDeviceID: Promise<string>
    multipleDeviceID: Promise<string>
    bundleAppName: Promise<string>
    appExecutablePath: Promise<string>
    projectType: Promise<"-workspace" | "-project" | "-package">
}

export interface SetProjectEnvInterface {
    setProjectFile(file: string): Promise<void>
    setProjectScheme(scheme: string): Promise<void>
    setProjectConfiguration(configuration: string): Promise<void>
    setDebugDeviceID(deviceID: string): Promise<void>
    setMultipleDeviceID(multiId: string): Promise<void>
    setPlatform(platform: string): Promise<void>
}

export class ProjectEnv implements ProjectEnvInterface, SetProjectEnvInterface {
    get platform(): Promise<Platform> {
        return currentPlatform();
    }
    get projectFile(): Promise<string> {
        return getProjectFileName();
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
        return getBundleAppName();
    }
    get appExecutablePath(): Promise<string> {
        return getTargetExecutable();
    }

    get projectType(): Promise<"-workspace" | "-project" | "-package"> {
        return this.projectFile.then((value) => {
            return getProjectType(value);
        });
    }

    async setProjectFile(file: string): Promise<void> {
        await saveKeyToEnvList("PROJECT_FILE", file);
    }
    async setProjectScheme(scheme: string): Promise<void> {
        await saveKeyToEnvList("PROJECT_SCHEME", scheme);
    }
    async setProjectConfiguration(configuration: string): Promise<void> {
        await saveKeyToEnvList("PROJECT_CONFIGURATION", configuration);
    }
    async setDebugDeviceID(deviceID: string): Promise<void> {
        await saveKeyToEnvList("DEVICE_ID", deviceID);
    }
    async setMultipleDeviceID(multiId: string): Promise<void> {
        await saveKeyToEnvList("MULTIPLE_DEVICE_ID", multiId);
    }
    async setPlatform(platform: string): Promise<void> {
        await saveKeyToEnvList("PLATFORM", platform);
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
    return {
        VS_IOS_PROJECT_ENV_FILE: getEnvFilePath(),
        VS_IOS_WORKSPACE_PATH: getWorkspacePath(),
        VS_IOS_SCRIPT_PATH: getScriptPath(),
        VS_IOS_XCODE_BUILD_SERVER_PATH: getXCodeBuildServerPath(),
        VS_IOS_XCODE_SDK: await sdk()
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
        return (await getEnvList())["PROJECT_FILE"].replace(/^"|"$/g, '');
    } catch {
        throw ProjectFileMissedError;
    }
}

export async function getProjectScheme() {
    try {
        return (await getEnvList())["PROJECT_SCHEME"].replace(/^"|"$/g, '');
    }
    catch {
        throw ProjectSchemeMissedError;
    }
}

export async function getProjectPlatform() {
    try {
        return (await getEnvList())["PLATFORM"].replace(/^"|"$/g, '');
    } catch {
        throw PlatformMissedError;
    }
}

export async function getProjectConfiguration() {
    try {
        return (await getEnvList())["PROJECT_CONFIGURATION"].replace(/^"|"$/g, '');
    } catch {
        throw ProjectConfigurationMissedError;
    }
}

export async function getDeviceId() {
    try {
        return (await getEnvList())["DEVICE_ID"].replace(/^"|"$/g, '');
    } catch {
        throw MultipleDeviceMissedError;
    }
}

export async function getMultiDeviceIds() {
    try {
        return (await getEnvList())["MULTIPLE_DEVICE_ID"].replace(/^"|"$/g, '');
    } catch {
        throw MultipleDeviceMissedError;
    }
}

export async function getBundleAppName() {
    try {
        return (await getEnvList())["BUNDLE_APP_NAME"].replace(/^"|"$/g, '');
    } catch {
        throw BundleAppNameMissedError;
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
    return path.join(__dirname, "..", "xcode-build-server");
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

export async function getEnvList() {
    return await asyncLock(getEnvFilePath(), () => {
        return readEnvFileToDict();
    });
}

export async function saveKeyToEnvList(key: string, value: string) {
    return await asyncLock(getEnvFilePath(), () => {
        const dict = readEnvFileToDict();
        dict[key] = `"${value}"`;

        let json = "";
        for (const [key, val] of Object.entries(dict)) {
            json += `${key}=${val}\n`
        }

        fs.writeFileSync(getEnvFilePath(), json, "utf-8");
    });
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

export function getBuildRootPath() {
    try {
        const json = JSON.parse(fs.readFileSync(getFilePathInWorkspace("buildServer.json"), "utf-8"));
        return json.build_root;
    } catch (error) {
        console.log(`Building folder is not set : ${error}`)
        return undefined;
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

export async function projectXcodeBuildSettings(projectFile: string, scheme: string, buildConfiguration: string) {
    const settings = await new Executor().execShell({
        cancellationToken: undefined,
        scriptOrCommand: { command: "xcodebuild" },
        args: ["-showBuildSettings", getProjectType(projectFile), projectFile, "-scheme", scheme, "-configuration", buildConfiguration, "-json"]
    });
    return JSON.parse(settings.stdout);
}

export async function getProductName() {
    const scheme = await getProjectScheme();
    const projectFile = await getProjectFileName();
    const projectSettings: any[] = await projectXcodeBuildSettings(projectFile, scheme, await getProjectConfiguration());

    return projectSettings[0].buildSettings.PRODUCT_NAME;
}

export async function getTargetExecutable() {
    try {
        const product_name = await getProductName();
        const build_path = getBuildRootPath();
        const build_configuration = await getProjectConfiguration();
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