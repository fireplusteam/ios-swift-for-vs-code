import { exec } from "child_process";
import * as fs from "fs";
import { glob } from "glob";
import * as path from "path";
import * as vscode from "vscode";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { ProjectManager } from "./ProjectManager/ProjectManager";
import { buildSelectedTarget } from "./buildCommands";
import {
    BuildServerConfiguration,
    DeviceID,
    getFilePathInWorkspace,
    getLSPWorkspacePath,
    getProjectPath,
    getProjectType,
    getScriptPath,
    getSWBBuildServicePath,
    getWorkspacePath,
    getXCodeBuildServerPath,
    isBuildServerValid,
    updateProject,
} from "./env";
import { Executor, ExecutorMode } from "./Executor";
import { handleValidationErrors } from "./extension";
import { QuickPickItem, showPicker } from "./inputPicker";
import { CustomError, emptyAppLog, isFolder } from "./utils";
import { CommandContext } from "./CommandManagement/CommandContext";
import { RunManager } from "./Services/RunManager";
import { BuildManager } from "./Services/BuildManager";
import { TestPlanIsNotConfigured } from "./Services/ProjectSettingsProvider";
import { PackageWorkspaceGenerator } from "./ProjectManager/PackageWorkspaceGenerator";
import { LogChannelInterface } from "./Logs/LogChannel";
import { TestProvider } from "./TestsProvider/TestProvider";

function filterDevices(
    devices: { [name: string]: string }[],
    isSelected: (device: { [name: string]: string }) => boolean
) {
    const items = devices
        .map<QuickPickItem | undefined>(device => {
            let formattedKey = "";
            if (
                Object.prototype.hasOwnProperty.call(device, "name") &&
                Object.prototype.hasOwnProperty.call(device, "OS")
            ) {
                formattedKey = `${device["name"]} - OS ${device["OS"]} `;
            } else if (Object.prototype.hasOwnProperty.call(device, "name")) {
                formattedKey = device["name"];
            } else if (Object.prototype.hasOwnProperty.call(device, "platform")) {
                formattedKey = device["platform"];
            } else {
                return undefined;
            }
            if (Object.prototype.hasOwnProperty.call(device, "variant")) {
                formattedKey += " " + device["variant"];
            }

            if (isSelected(device)) {
                return {
                    label: "$(notebook-state-success) " + formattedKey,
                    picked: true,
                    value: device,
                };
            } else {
                return { label: formattedKey, value: device };
            }
        })
        .filter((item): item is QuickPickItem => item !== undefined);
    return items;
}

export async function selectProjectFile(
    commandContext: CommandContext,
    projectManager: ProjectManager,
    showProposalMessage = false,
    ignoreFocusOut = false
) {
    const workspaceEnd = ".xcworkspace/contents.xcworkspacedata";
    const projectEnd = ".xcodeproj/project.pbxproj";
    const excludeEnd = ".xcodeproj/project.xcworkspace";
    // includes workspace/project/package.swift but exclude .vscode/xcode folder
    const include: vscode.GlobPattern = `{**/{*${workspaceEnd},*${projectEnd}},Package.swift,!.vscode/xcode/**}`;
    const files = await glob(include, {
        absolute: true,
        cwd: getWorkspacePath(),
        nodir: true,
    });

    const options = files
        .filter(file => {
            if (file.endsWith(projectEnd)) {
                for (const checkFile of files) {
                    if (
                        checkFile.endsWith(workspaceEnd) &&
                        checkFile.slice(0, -workspaceEnd.length) ===
                            file.slice(0, -projectEnd.length)
                    ) {
                        return false;
                    }
                }
            }
            return true;
        })
        .map(file => {
            if (path.basename(file) === "Package.swift") {
                const relativeProjectPath = path.relative(getWorkspacePath(), file);
                return { label: relativeProjectPath, value: file };
            }
            const relativeProjectPath = path
                .relative(getWorkspacePath(), file)
                .split(path.sep)
                .slice(0, -1)
                .join(path.sep);
            return {
                label: relativeProjectPath,
                value: path.dirname(file),
            };
        })
        .filter(file => {
            if (file.value.endsWith(excludeEnd)) {
                return false;
            }
            return true;
        });
    if (options.length === 0) {
        if (showProposalMessage === false) {
            vscode.window.showErrorMessage(
                "Workspace doesn't have any iOS project or workspace file"
            );
        }
        return false;
    } else if (showProposalMessage) {
        const isAllowedToConfigure = await vscode.window.showInformationMessage(
            "Workspace has iOS projects. Do you want to pick a project to configure?",
            "Yes",
            "No"
        );
        if (isAllowedToConfigure !== "Yes") {
            return false;
        }
    }

    const selection: string | undefined = await showPicker(
        options,
        "Select Project File",
        "Please select your project file",
        false,
        ignoreFocusOut,
        true
    );
    if (selection === undefined || selection === "") {
        return false;
    }
    let projectPath = selection;
    let swiftPackagePath: string | undefined = undefined;
    if (getProjectType(selection) === "-package") {
        // convert Swift Package to Xcode Workspace with tuist tool support
        swiftPackagePath = selection;
        projectPath = await generateXcodeWorkspaceForPackage(commandContext, selection);
        await commandContext.projectEnv.setSwiftPackageProjectFileGenerated();
    }
    await updateProject(commandContext.projectEnv, projectPath, swiftPackagePath);
    await projectManager.loadProjectFiles(true);
    await checkWorkspace(commandContext, true);

    return true;
}

export async function generateXcodeWorkspaceForPackage(
    commandContext: CommandContext,
    packageSwiftPath: string
) {
    const workspaceGenerator = new PackageWorkspaceGenerator();
    workspaceGenerator.generateDummyWorkspaceSwiftFile(packageSwiftPath);
    const workspaceFilePath = workspaceGenerator.workspaceDummyFile;

    const folder = workspaceFilePath.split(path.sep).slice(0, -1).join(path.sep);
    const gitFolder = packageSwiftPath.split(path.sep).slice(0, -1).join(path.sep);
    if (!fs.existsSync(path.join(gitFolder, ".git"))) {
        const selection = await vscode.window.showInformationMessage(
            `Workspace can not be generated without .git folder initialized. Do you want to initialize git repository for Tuist in folder: ${gitFolder}?`,
            { modal: true },
            "Yes",
            "No"
        );
        if (selection === "Yes") {
            await commandContext.execShellWithOptions({
                scriptOrCommand: {
                    command: `xcrun git init`,
                    labelInTerminal: `Initializing git for Tuist`,
                },
                mode: ExecutorMode.verbose,
                cwd: gitFolder,
            });
        }
    }

    await commandContext.execShellWithOptions({
        scriptOrCommand: {
            command: `tuist install`,
            labelInTerminal: `Installing Tuist dependencies for Swift Package: ${packageSwiftPath}`,
        },
        mode: ExecutorMode.verbose,
        cwd: folder,
    });
    await commandContext.execShellWithOptions({
        scriptOrCommand: {
            command: `tuist generate --no-open`,
            labelInTerminal: `Generating Xcode Workspace for Swift Package: ${packageSwiftPath}`,
        },
        mode: ExecutorMode.verbose,
        cwd: folder,
    });
    return path.join(folder, "Workspace.xcworkspace");
}

export async function selectScheme(commandContext: CommandContext, ignoreFocusOut = false) {
    try {
        const schemes = await commandContext.projectSettingsProvider.fetchSchemes();
        let currentScheme: string;
        try {
            currentScheme = await commandContext.projectEnv.projectScheme;
        } catch {
            currentScheme = "";
        }
        const json = schemes.map<QuickPickItem>(scheme => {
            if (currentScheme === scheme) {
                return { label: "$(notebook-state-success) " + scheme, value: scheme };
            } else {
                return { label: scheme, value: scheme };
            }
        });

        const option = await showPicker(
            json,
            "Target",
            "Please select Target",
            false,
            ignoreFocusOut,
            true
        );

        if (option === undefined) {
            return false;
        }
        await commandContext.projectEnv.setProjectScheme(option);
    } catch (error) {
        return await handleValidationErrors(commandContext, error, async () => {
            await selectScheme(commandContext, ignoreFocusOut);
        });
    }
}

export async function selectConfiguration(commandContext: CommandContext, ignoreFocusOut = false) {
    try {
        const configurations = await commandContext.projectSettingsProvider.fetchConfigurations();
        let currentConfiguration: string;
        try {
            currentConfiguration = await commandContext.projectEnv.projectConfiguration;
        } catch {
            currentConfiguration = "";
        }
        const json = configurations.map<QuickPickItem>(configuration => {
            if (currentConfiguration === configuration) {
                return {
                    label: "$(notebook-state-success) " + configuration,
                    value: configuration,
                };
            } else {
                return { label: configuration, value: configuration };
            }
        });

        const option = await showPicker(
            json,
            "Configuration",
            "Please Select Build Configuration",
            false,
            ignoreFocusOut,
            true
        );

        if (option === undefined) {
            return false;
        }

        await commandContext.projectEnv.setProjectConfiguration(option);
    } catch (error) {
        return await handleValidationErrors(commandContext, error, async () => {
            await selectConfiguration(commandContext, ignoreFocusOut);
        });
    }
}

async function selectTestPlan(commandContext: CommandContext, ignoreFocusOut = false) {
    try {
        let testPlans: string[] = [];
        try {
            testPlans = await commandContext.projectSettingsProvider.testPlans;
            if (testPlans.length === 0) {
                vscode.window.showErrorMessage(
                    "There're no available Test Plans to select for given scheme/project configuration."
                );
                return false;
            }
        } catch (error) {
            if (error instanceof CustomError && error.isEqual(TestPlanIsNotConfigured)) {
                vscode.window.showErrorMessage(
                    "There're no available Test Plans to select for given scheme/project configuration."
                );
                return false;
            } else {
                throw error;
            }
        }

        const json = testPlans.map<QuickPickItem>(testPlan => {
            return { label: testPlan, value: testPlan };
        });

        const option = await showPicker(
            json,
            "Test Plan",
            "Please Select Test Plan Configuration",
            false,
            ignoreFocusOut,
            true
        );

        if (option === undefined) {
            return false;
        }

        return option;
    } catch (error) {
        return await handleValidationErrors(commandContext, error, async () => {
            await selectTestPlan(commandContext, ignoreFocusOut);
        });
    }
}

export async function runTestPlan(commandContext: CommandContext, testProvider: TestProvider) {
    const testPlan = (await selectTestPlan(commandContext)) as string | undefined;
    if (!testPlan) {
        return;
    }
    await testProvider.runTestPlan(testPlan, commandContext);
}

export async function selectDevice(commandContext: CommandContext, ignoreFocusOut = false) {
    try {
        const devices = await commandContext.projectSettingsProvider.fetchDevices();
        let selectedDeviceID: DeviceID;
        try {
            selectedDeviceID = await commandContext.projectEnv.debugDeviceID;
        } catch {
            selectedDeviceID = { id: "", name: "", OS: "", platform: "macOS" };
        }
        const items = filterDevices(devices, device => selectedDeviceID.id === device["id"]);

        if (items.length === 0) {
            vscode.window.showErrorMessage(
                "There're no available devices to select for given scheme/project configuration. Likely, need to install simulators first!"
            );
            return false;
        }

        const option = await showPicker(
            items,
            "Device",
            "Please select Device for DEBUG",
            false,
            ignoreFocusOut,
            true
        );

        if (option === undefined) {
            return false;
        }
        if (typeof option === "object") {
            const obj = option as DeviceID;
            await commandContext.projectEnv.setDebugDeviceID(obj);
        }
    } catch (error) {
        return await handleValidationErrors(commandContext, error, async () => {
            await selectDevice(commandContext, ignoreFocusOut);
        });
    }
}

export async function updatePackageDependencies(commandContext: CommandContext, check = true) {
    if (check) {
        await checkWorkspace(commandContext);
    }
    const buildManager = new BuildManager();
    await buildManager.checkFirstLaunchStatus(commandContext);
    // at this point everything is set
    commandContext.projectEnv.firstLaunchedConfigured = true;
}

export async function checkWorkspace(commandContext: CommandContext, ignoreFocusOut = false) {
    try {
        let validProjectScheme: boolean = false;
        try {
            validProjectScheme = !((await commandContext.projectEnv.projectScheme) === "");
        } catch {
            validProjectScheme = false;
        }
        if (
            validProjectScheme === false &&
            (await selectScheme(commandContext, ignoreFocusOut)) === false
        ) {
            return false;
        }

        let validProjectConfiguration = false;
        try {
            validProjectConfiguration = !(
                (await commandContext.projectEnv.projectConfiguration) === ""
            );
        } catch {
            validProjectConfiguration = false;
        }
        if (
            validProjectConfiguration === false &&
            (await selectConfiguration(commandContext, ignoreFocusOut)) === false
        ) {
            return false;
        }

        let validDebugDeviceID = false;
        try {
            validDebugDeviceID = !((await commandContext.projectEnv.debugDeviceID).id === "");
        } catch {
            validDebugDeviceID = false;
            if (
                validDebugDeviceID === false &&
                (await selectDevice(commandContext, ignoreFocusOut)) === false
            ) {
                return false;
            }
        }

        await checkSwiftPackageWorkspace(commandContext);

        if (commandContext.projectEnv.firstLaunchedConfigured === false) {
            try {
                await updatePackageDependencies(commandContext, false);
            } catch {
                /// might not work as expected as dependencies are not updated
                /// but we can continue anyway to let user work with the project, but try to update deps next time
            }
        }
        await generateXcodeServer(commandContext, false);
    } catch (error) {
        await handleValidationErrors(commandContext, error, async () => {
            return await checkWorkspace(commandContext, ignoreFocusOut);
        });
    }
}

export async function checkSwiftPackageWorkspace(commandContext: CommandContext) {
    if ((await commandContext.projectEnv.swiftPackageProjectFileGenerated) === false) {
        let swiftPackageFile = await commandContext.projectEnv.swiftPackageFile;
        if (swiftPackageFile !== undefined && swiftPackageFile !== "") {
            swiftPackageFile = getFilePathInWorkspace(swiftPackageFile);
            await generateXcodeWorkspaceForPackage(commandContext, swiftPackageFile);
            await commandContext.projectEnv.setSwiftPackageProjectFileGenerated();
        }
    }
}

export async function generateXcodeServer(commandContext: CommandContext, check = true) {
    if (check) {
        await checkWorkspace(commandContext);
    }
    const env = commandContext.projectEnv;
    const lspFolder = await getLSPWorkspacePath();
    const projectType = await env.projectType;
    const projectWorkspace = path.join(
        getFilePathInWorkspace(await env.projectFile),
        "project.xcworkspace"
    );
    if (projectType === "-project") {
        // This's a workaround, if the workspace is not there, we need to create an empty folder to make everything working
        if (!fs.existsSync(projectWorkspace)) {
            fs.mkdirSync(projectWorkspace, { recursive: true });
        }
    }
    function getBuildDir(settings: any): string | undefined {
        if (settings.length === 0) {
            return undefined;
        }
        if (settings.at(0).buildSettings === undefined) {
            return undefined;
        }
        const buildDir = settings.at(0).buildSettings.SYMROOT;
        if (buildDir === undefined || buildDir === null || buildDir === "") {
            return undefined;
        }
        return buildDir;
    }
    async function getFirstBuildDir(): Promise<string | undefined> {
        // get settings for the current scheme first
        const settings = await commandContext.projectSettingsProvider.settings;
        const buildDir = getBuildDir(settings);
        if (buildDir !== undefined) {
            return buildDir;
        }
        try {
            const schemes = await commandContext.projectSettingsProvider.fetchSchemes();
            // try all other targets from the root project first as they are more relevant
            for (const scheme of schemes) {
                try {
                    const settings =
                        await commandContext.projectSettingsProvider.getSettingsForScheme(scheme);
                    const buildDir = getBuildDir(settings);
                    if (buildDir !== undefined) {
                        return buildDir;
                    }
                } catch {
                    // do nothing and try next scheme
                }
            }
        } catch {
            // do nothing
        }

        return undefined;
    }
    const buildDir = await getFirstBuildDir();
    if (buildDir === undefined) {
        const option = await vscode.window.showErrorMessage(
            `Cannot generate Build Server configuration as 'Build Directory' is not set in build settings for ${await commandContext.projectEnv.projectScheme}. Please, make sure that your project scheme has a valid Build Configuration selected and try again.`,
            "Select Another Scheme",
            "Cancel"
        );
        if (option === "Select Another Scheme") {
            await selectScheme(commandContext);
            await generateXcodeServer(commandContext, false);
            return;
        }
        // set build root to SYMROOT if it's set
        throw Error("No Build Server configuration generated for selected scheme");
    }
    const buildServerConfigData: BuildServerConfiguration = {
        name: "xcode build server",
        version: "1.3.0",
        bspVersion: "2.2.0",
        languages: ["c", "cpp", "objective-c", "objective-cpp", "swift"],
        argv: [getXCodeBuildServerPath()],
        workspace: projectWorkspace,
        build_root: path.join(buildDir, "../.."),
        kind: "xcode",
    };
    if ((await isBuildServerValid(buildServerConfigData)) === true) {
        return;
    }

    const buildServerConfigPath = path.join(lspFolder.fsPath, "buildServer.json");
    fs.writeFileSync(buildServerConfigPath, JSON.stringify(buildServerConfigData, null, 4), "utf8");

    try {
        await commandContext
            .execShellParallel({
                scriptOrCommand: { file: "update_git_exclude_if_any.py" },
            })
            .catch(error => {
                commandContext.log.error(`Git exclude was not updated. Error: ${error}`);
            });
    } catch {
        // do nothing
    }

    commandContext.lspClient.restart();
}

export async function openXCode(activeFile: string, log: LogChannelInterface) {
    const openExec = new Executor();
    const stdout = (
        await openExec.execShell({
            scriptOrCommand: { file: "open_xcode.sh" },
            args: [await getProjectPath()],
        })
    ).stdout;
    log.info(`open Xcode script stdout: ${stdout}`);
    if (!isFolder(activeFile)) {
        exec(`open -a Xcode '${activeFile}'`);
    }
}

export async function runApp(
    commandContext: CommandContext,
    sessionID: string,
    isDebuggable: boolean
) {
    await checkWorkspace(commandContext, false);
    const runManager = new RunManager(sessionID, isDebuggable);
    await runManager.runOnDebugDevice(commandContext);
}

export async function runAppOnMultipleDevices(
    commandContext: CommandContext,
    sessionID: string,
    problemResolver: ProblemDiagnosticResolver
) {
    try {
        if ((await commandContext.projectEnv.debugDeviceID).platform === "macOS") {
            vscode.window.showErrorMessage(
                "MacOS Platform doesn't support running on Multiple Devices"
            );
            return;
        }

        const devices = await commandContext.projectSettingsProvider.fetchDevices();
        let selectedDeviceID: DeviceID[];
        try {
            selectedDeviceID = await commandContext.projectEnv.multipleDeviceID;
        } catch {
            selectedDeviceID = [];
        }
        const items = filterDevices(
            devices,
            device =>
                selectedDeviceID.find(selectedDevice => device["id"] === selectedDevice.id) !==
                undefined
        );

        if (items.length === 0) {
            vscode.window.showErrorMessage(
                "There're no available devices to select for given scheme/project configuration. Likely, need to install simulators first!"
            );
            return false;
        }

        const option = await showPicker(
            items,
            "Devices",
            "Please select Multiple Devices to Run You App",
            true,
            false,
            true
        );

        if (option === undefined || option === "") {
            return false;
        }

        const deviceIds: DeviceID[] = [];
        if (Array.isArray(option)) {
            for (const device of option) {
                deviceIds.push(device);
            }
            commandContext.projectEnv.setMultipleDeviceID(deviceIds);
        }

        await buildSelectedTarget(commandContext, problemResolver);

        for (const device of deviceIds) {
            emptyAppLog(device.id);
        }
        const runApp = new RunManager(sessionID, false);
        await runApp.runOnMultipleDevices(commandContext);
    } catch (error) {
        await handleValidationErrors(commandContext, error, async () => {
            return await runAppOnMultipleDevices(commandContext, sessionID, problemResolver);
        });
    }
}

export async function runAndDebugTests(
    commandContext: CommandContext,
    sessionID: string,
    isDebuggable: boolean,
    tests: string[],
    xctestrun: string,
    isCoverage: boolean
) {
    await checkWorkspace(commandContext, false);
    const runManager = new RunManager(sessionID, isDebuggable);
    await runManager.runTests(commandContext, tests, xctestrun, isCoverage);
}

export async function enableSWBBuildService(enabled: boolean) {
    try {
        let checkSWBService: string | undefined = undefined;
        try {
            checkSWBService = await checkSWBBuildServiceEnabled(enabled, getSWBBuildServicePath());
        } catch {
            // do nothing
        }
        if (checkSWBService === undefined) {
            return;
        }
        const password = await requestSudoPasswordForSWBBuildService(enabled);
        if (password === undefined) {
            throw new Error("User cancelled sudo password input");
        }
        try {
            if (checkSWBService !== undefined) {
                await installUninstallBuildService(enabled, password, getSWBBuildServicePath());
            }
        } catch (error) {
            if (error instanceof Error && error.message === "Retry") {
                return await enableSWBBuildService(enabled);
            } else {
                throw error;
            }
        }
    } catch (error) {
        // rollback setting to previous value for current target configuration
        vscode.workspace
            .getConfiguration("vscode-ios")
            .update("swb.build.service", !enabled, vscode.ConfigurationTarget.Global);
    }
}

async function checkSWBBuildServiceEnabled(enabled: boolean, servicePath: string) {
    const checkIfInjectedCommand = `python3 ${getScriptPath("xcode_service_setup.py")} -isProxyInjected ${servicePath}`;
    return new Promise<string>((resolve, reject) => {
        exec(checkIfInjectedCommand, error => {
            if ((enabled && error === null) || (!enabled && error !== null)) {
                reject(new Error("No need to change state"));
                return;
            }
            const isInstallStr = enabled ? "INSTALL" : "DISABLED";
            resolve(isInstallStr);
        });
    });
}

async function requestSudoPasswordForSWBBuildService(enabled: boolean) {
    const password = await vscode.window.showInputBox({
        ignoreFocusOut: false,
        prompt: `In order to ${enabled ? "install" : "uninstall"} SWBBuildService, please enter sudo password. This is required to grant necessary permissions to the service. (You can always disable that feature in extension settings)`,
        password: true,
    });
    return password;
}

async function installUninstallBuildService(
    enabled: boolean,
    password: string,
    servicePath: string
) {
    const install = enabled ? "-install" : "-uninstall";
    const command = `echo '${password}' | sudo -S python3 ${getScriptPath("xcode_service_setup.py")} ${install} ${servicePath} `;
    const serviceName = servicePath.split(path.sep).at(-1);
    return new Promise<void>((resolve, reject) => {
        exec(command, error => {
            if (error) {
                let privacyButton = undefined;
                let errorMessage = enabled
                    ? `Failed to install ${serviceName} proxy`
                    : `Failed to uninstall ${serviceName} proxy`;
                if (
                    error.toString().includes("PermissionError: [Errno 1] Operation not permitted:")
                ) {
                    errorMessage += `: Permission denied. Make sure the password is correct and you gave a full disk control to VSCode in System Preferences -> Security & Privacy -> Privacy -> Full Disk Access.`;
                    privacyButton = "Open System Preferences";
                } else if (error.toString().includes("Password:Sorry, try again.")) {
                    errorMessage += `: Wrong password provided.`;
                }
                const buttons = privacyButton
                    ? [privacyButton, "Retry", "Cancel"]
                    : ["Retry", "Cancel"];
                vscode.window.showErrorMessage(errorMessage, ...buttons).then(selection => {
                    if (selection === "Retry") {
                        reject(new Error("Retry"));
                    } else if (selection === "Open System Preferences") {
                        // open macOS settings -> security & privacy settings -> privacy -> full disk access
                        vscode.env.openExternal(
                            vscode.Uri.parse(
                                "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
                            )
                        );
                        resolve();
                    } else {
                        resolve();
                    }
                });
            } else {
                if (enabled) {
                    vscode.window.showInformationMessage(`${serviceName} proxy setup successfully`);
                } else {
                    vscode.window.showInformationMessage(
                        `${serviceName} Proxy was uninstall successfully`
                    );
                }
                resolve();
            }
        });
    });
}

export async function openFile(
    filePath: string,
    lineNumber: number | undefined,
    viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active
) {
    const fileUri = vscode.Uri.file(path.resolve(filePath));
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document, viewColumn, false);
    if (lineNumber === undefined) {
        return;
    }
    editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
    await vscode.commands.executeCommand("cursorMove", {
        to: "down",
        select: false,
        by: "line",
        value: lineNumber,
    });
}

// diff
export async function ksdiff(name: string, path1: string, path2: string) {
    const filePrefix = "file://";
    if (path1.startsWith(filePrefix)) {
        path1 = path1.slice(filePrefix.length);
    }
    if (path2.startsWith(filePrefix)) {
        path2 = path2.slice(filePrefix.length);
    }
    vscode.commands.executeCommand(
        "vscode.diff",
        vscode.Uri.file(path1),
        vscode.Uri.file(path2),
        name
    );
}
