import path from "path";
import * as vscode from "vscode";
import fs from "fs";
import { CustomError, emptyLog } from "./utils";
import { XCodeSettings } from "./Services/ProjectSettingsProvider";

export const ProjectFileMissedError = new CustomError(
    "Project File is not set in .vscode/xcode/projectConfiguration.json file. Please select project or workspace Xcode file"
);
export const ProjectSchemeMissedError = new CustomError(
    "Project scheme is not set in .vscode/xcode/projectConfiguration.json file. Please run the command to select it!"
);
export const ProjectConfigurationMissedError = new CustomError(
    "Project configuration is not set in .vscode/xcode/projectConfiguration.json. Please run the command to select it"
);
export const DebugDeviceIDMissedError = new CustomError("DebugDeviceIDMissedError");
export const MultipleDeviceMissedError = new CustomError("MultipleDeviceMissedError");
export const BundleAppNameMissedError = new CustomError("BundleAppNameMissedError");
export const AppExecutablePathMissedError = new CustomError("AppExecutablePathMissedError");
export const PlatformMissedError = new CustomError("PlatformMissedError");
export const AppTargetExecutableMissedError = new CustomError("AppTargetExecutableMissedError");
export const ProductNameMissedError = new CustomError("ProductNameMissedError");

export const ConfigurationProjectError = new CustomError(
    "Project configuration was changed by another operation. Can not be modified by this one"
);

export interface DeviceID {
    id: string;
    name: string;
    OS: string;
    platform:
        | "macOS"
        | "iOS Simulator"
        | "watchOS Simulator"
        | "visionOS Simulator"
        | "tvOS Simulator";
    variant?: string;
}

export interface ProjectEnvInterface {
    projectFile: Promise<string>;
    projectScheme: Promise<string>;
    projectConfiguration: Promise<string>;
    debugDeviceID: Promise<DeviceID>;
    multipleDeviceID: Promise<DeviceID[]>;
    bundleAppName: Promise<string>;
    appExecutablePath: (deviceID: DeviceID) => Promise<string>;
    projectType: Promise<"-workspace" | "-project" | "-package">;
    productName: Promise<string>;
}

export interface SetProjectEnvInterface {
    setProjectFile(file: string): Promise<void>;
    setProjectScheme(scheme: string): Promise<void>;
    setProjectConfiguration(configuration: string): Promise<void>;
    setDebugDeviceID(deviceID: DeviceID): Promise<void>;
    setMultipleDeviceID(multiId: DeviceID[]): Promise<void>;
}

export class ProjectEnv implements ProjectEnvInterface, SetProjectEnvInterface {
    private settingsProvider: XCodeSettings;
    private configuration: { [key: string]: any };

    constructor(settings: XCodeSettings) {
        this.settingsProvider = settings;
        this.configuration = getEnvList();
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

    get projectFile(): Promise<string> {
        return getProjectFileName().then(projectFile => {
            if (!fs.existsSync(getFilePathInWorkspace(projectFile))) {
                this.emptySessions();
                throw ProjectFileMissedError;
            }
            return projectFile;
        });
    }

    get projectScheme(): Promise<string> {
        return Promise.resolve(getProjectScheme(this.configuration));
    }
    get projectConfiguration(): Promise<string> {
        return Promise.resolve(getProjectConfiguration(this.configuration));
    }
    get debugDeviceID(): Promise<DeviceID> {
        return Promise.resolve(getDeviceId(this.configuration));
    }
    get multipleDeviceID(): Promise<DeviceID[]> {
        return Promise.resolve(getMultiDeviceIds(this.configuration));
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
    appExecutablePath(deviceID: DeviceID): Promise<string> {
        return this.productName.then(productName => {
            return this.projectConfiguration.then(configuration => {
                return getTargetExecutable(deviceID, productName, configuration);
            });
        });
    }

    get projectType(): Promise<"-workspace" | "-project" | "-package"> {
        return this.projectFile.then(value => {
            return getProjectType(value);
        });
    }

    async setProjectFile(file: string): Promise<void> {
        saveKeyToEnvList(this.configuration, "PROJECT_FILE", file);
    }
    async setProjectScheme(scheme: string): Promise<void> {
        saveKeyToEnvList(this.configuration, "PROJECT_SCHEME", scheme);
    }
    async setProjectConfiguration(configuration: string): Promise<void> {
        saveKeyToEnvList(this.configuration, "PROJECT_CONFIGURATION", configuration);
    }
    async setDebugDeviceID(deviceID: DeviceID): Promise<void> {
        saveKeyToEnvList(this.configuration, "DEVICE_ID", deviceID);
    }
    async setMultipleDeviceID(multiId: DeviceID[]): Promise<void> {
        saveKeyToEnvList(this.configuration, "MULTIPLE_DEVICE_ID", multiId);
    }
    async setPlatform(platform: string): Promise<void> {
        saveKeyToEnvList(this.configuration, "PLATFORM", platform);
    }

    async emptySessions() {
        emptyLog(getEnvFilePath());
    }
}

export function getWorkspaceFolder() {
    const workspace = vscode.workspace.workspaceFolders?.at(0)?.uri;
    return workspace;
}

export async function getLSPWorkspacePath() {
    // used to have the same folder as for project or workspace
    const lspFolder = getFilePathInWorkspace(await getProjectFolderPath());
    return vscode.Uri.file(path.join(lspFolder));
}

export function getWorkspacePath() {
    const workspace = getWorkspaceFolder()?.fsPath || "";
    return workspace;
}

function getVSCodePath() {
    return path.join(getWorkspacePath(), ".vscode");
}

function getEnvFilePath() {
    return path.join(getVSCodePath(), "xcode", "projectConfiguration.json");
}

export async function updateProject(projectEvn: ProjectEnv, projectPath: string) {
    const relative = path.relative(getWorkspacePath(), projectPath);
    fs.mkdirSync(getVSCodePath(), { recursive: true });
    await projectEvn.setProjectFile(relative);
}

export function getScriptPath(script: string | undefined = undefined) {
    if (script === undefined) {
        return path.join(__dirname, "..", "..", "resources");
    }
    return path.join(__dirname, "..", "..", "resources", script);
}

export function getFilePathInWorkspace(fileName: string) {
    return path.join(getWorkspacePath(), fileName);
}

export async function getProjectFileName() {
    const configuration = getEnvList();
    const val = configuration.PROJECT_FILE;
    if (val === undefined) {
        throw ProjectFileMissedError;
    }
    return val;
}

function getProjectScheme(configuration: { [key: string]: string }) {
    const val = configuration["PROJECT_SCHEME"];
    if (val === undefined) {
        throw ProjectSchemeMissedError;
    }
    return val;
}

function getProjectConfiguration(configuration: { [key: string]: string }) {
    const val = configuration["PROJECT_CONFIGURATION"];
    if (val === undefined) {
        throw ProjectConfigurationMissedError;
    }
    return val;
}

function getDeviceId(configuration: { [key: string]: any }): DeviceID {
    const val = configuration["DEVICE_ID"];
    if (val === undefined) {
        throw DebugDeviceIDMissedError;
    }
    return val;
}

function getMultiDeviceIds(configuration: { [key: string]: any }) {
    const val = configuration["MULTIPLE_DEVICE_ID"];
    if (val === undefined) {
        throw MultipleDeviceMissedError;
    }
    return val;
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
    return path.join(__dirname, "..", "..", "xcode-build-server", "xcode-build-server");
}

export function getXCBBuildServicePath() {
    return path.join(__dirname, "..", "..", "dist", "XCBBuildService");
}

function readEnvFileToDict() {
    if (fs.existsSync(getEnvFilePath()) === false) {
        return {};
    }
    try {
        const lines = fs.readFileSync(getEnvFilePath(), "utf-8");
        const json = JSON.parse(lines) as { [name: string]: any };
        return json;
    } catch {
        return {};
    }
}

function getEnvList() {
    return readEnvFileToDict();
}

function saveKeyToEnvList(configuration: { [key: string]: any }, key: string, value: any) {
    const dict = readEnvFileToDict();
    if (JSON.stringify(dict) !== JSON.stringify(configuration)) {
        throw ConfigurationProjectError;
    }
    configuration[key] = value;
    const json = JSON.stringify(configuration);
    const fileDir = getEnvFilePath().split(path.sep).slice(0, -1).join(path.sep);
    fs.mkdirSync(fileDir, { recursive: true });
    fs.writeFileSync(getEnvFilePath(), json, "utf-8");
}

export async function isWorkspaceOpened() {
    try {
        const projectName = await getProjectFileName();
        if (projectName.length === 0) {
            return false;
        }

        const workspaceFile = vscode.workspace.workspaceFile?.fsPath;
        if (workspaceFile === undefined) {
            return false;
        }
        if (!workspaceFile.includes(`.vscode/xcode/${projectName}`)) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

export async function isActivated() {
    const env = getEnvList();
    if (!Object.prototype.hasOwnProperty.call(env, "PROJECT_FILE")) {
        return false;
    }
    if (!isWorkspaceOpened()) {
        return false;
    }
    return true;
}

async function getBuildServerJsonPath() {
    return path.join((await getLSPWorkspacePath()).fsPath, "buildServer.json");
}

async function getBuildServerJson() {
    return JSON.parse(fs.readFileSync(await getBuildServerJsonPath(), "utf-8").toString());
}

export async function getBuildRootPath() {
    try {
        const json = await getBuildServerJson();
        return json.build_root;
    } catch (error) {
        console.log(`Building folder is not set : ${error}`);
        return undefined;
    }
}

export async function isBuildServerValid() {
    try {
        const buildServer = await getBuildServerJson();
        if (
            buildServer.workspace.indexOf(getFilePathInWorkspace(await getProjectFileName())) === -1
        ) {
            return false;
        }
        const configuration = getEnvList();
        if ((await getProjectScheme(configuration)) !== buildServer.scheme) {
            return false;
        }
        if (
            buildServer.build_root === undefined ||
            buildServer.workspace === undefined ||
            buildServer.kind === undefined ||
            buildServer.argv === undefined
        ) {
            return false;
        }
        if (configuration.build_root === getWorkspaceFolder()) {
            return false; // build folder can not be the same as workspace
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

async function getTargetExecutable(
    deviceID: DeviceID,
    product_name: string,
    build_configuration: string
) {
    try {
        // if get_project_type(list["PROJECT_FILE"]) == "-package":
        //     return "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/Library/Xcode/Agents/xctest"
        const build_path = await getBuildRootPath();
        switch (deviceID.platform) {
            case "macOS":
                return `${build_path}/Build/Products/${build_configuration}/${product_name}.app`;
            case "watchOS Simulator":
                return `${build_path}/Build/Products/${build_configuration}-watchsimulator/${product_name}.app`;
            case "visionOS Simulator":
                return `${build_path}/Build/Products/${build_configuration}-xrsimulator/${product_name}.app`;
            case "tvOS Simulator":
                return `${build_path}/Build/Products/${build_configuration}-appletvsimulator/${product_name}.app`;
            case "iOS Simulator":
                return `${build_path}/Build/Products/${build_configuration}-iphonesimulator/${product_name}.app`;
        }
    } catch {
        throw AppTargetExecutableMissedError;
    }
}
