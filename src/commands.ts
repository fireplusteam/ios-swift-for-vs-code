import { exec } from "child_process";
import * as fs from "fs";
import { glob } from "glob";
import * as path from "path";
import * as vscode from "vscode";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { ProjectManager } from "./ProjectManager/ProjectManager";
import { buildSelectedTarget } from "./buildCommands";
import {
    DeviceID,
    getFilePathInWorkspace,
    getLSPWorkspacePath,
    getProjectPath,
    getProjectType,
    getScriptPath,
    getWorkspacePath,
    getXCBBuildServicePath,
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
            if (file.endsWith("Package.swift")) {
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
                value: file.split(path.sep).slice(0, -1).join(path.sep),
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

export async function selectTarget(commandContext: CommandContext, ignoreFocusOut = false) {
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
            await selectTarget(commandContext, ignoreFocusOut);
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

export async function selectTestPlan(commandContext: CommandContext, ignoreFocusOut = false) {
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

        let currentTestPlan: string;
        try {
            currentTestPlan = await commandContext.projectEnv.projectTestPlan;
        } catch {
            currentTestPlan = "";
        }
        const json = testPlans.map<QuickPickItem>(testPlan => {
            if (currentTestPlan === testPlan) {
                return {
                    label: "$(notebook-state-success) " + testPlan,
                    value: testPlan,
                };
            } else {
                return { label: testPlan, value: testPlan };
            }
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

        await commandContext.projectEnv.setProjectTestPlan(option);
    } catch (error) {
        return await handleValidationErrors(commandContext, error, async () => {
            await selectTestPlan(commandContext, ignoreFocusOut);
        });
    }
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
            (await selectTarget(commandContext, ignoreFocusOut)) === false
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
            await updatePackageDependencies(commandContext, false);
        }
        if ((await isBuildServerValid(commandContext.projectEnv)) === false) {
            await generateXcodeServer(commandContext, false);
        }
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
    const relativeProjectPath = path.relative(
        lspFolder.fsPath,
        getFilePathInWorkspace(await env.projectFile)
    );
    const projectType = await env.projectType;
    if (projectType === "-project") {
        // This's a workaround, if the workspace is not there, we need to create an empty folder to make everything working
        const projectWorkspace = path.join(
            getFilePathInWorkspace(await env.projectFile),
            "project.xcworkspace"
        );
        if (!fs.existsSync(projectWorkspace)) {
            fs.mkdirSync(projectWorkspace, { recursive: true });
        }
    }
    await commandContext.execShellWithOptions({
        scriptOrCommand: { command: getXCodeBuildServerPath() },
        cwd: lspFolder.fsPath,
        args: ["config", "-scheme", await env.autoCompleteScheme, projectType, relativeProjectPath],
    });

    await commandContext
        .execShellParallel({
            scriptOrCommand: { file: "update_git_exclude_if_any.py" },
        })
        .catch(error => {
            commandContext.log.error(`Git exclude was not updated. Error: ${error}`);
        });

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

export async function enableXCBBuildService(enabled: boolean) {
    const checkIfInjectedCommand = `python3 ${getScriptPath("xcode_service_setup.py")} -isProxyInjected`;

    return new Promise<void>(resolve => {
        exec(checkIfInjectedCommand, async error => {
            if ((enabled && error === null) || (!enabled && error !== null)) {
                resolve();
                return;
            }
            const isInstallStr = enabled ? "INSTALL" : "DISABLED";
            const password = await vscode.window.showInputBox({
                ignoreFocusOut: false,
                prompt: `In order to ${isInstallStr} XCBBuildService, please enter sudo password. This is required to grant necessary permissions to the service. (You can always disable that feature in extension settings)`,
                password: true,
            });
            if (password === undefined) {
                resolve();
                return;
            }
            const install = enabled ? "-install" : "-uninstall";
            const command = `echo '${password}' | sudo -S python3 ${getScriptPath("xcode_service_setup.py")} ${install} ${getXCBBuildServicePath()} `;
            exec(command, error => {
                if (error) {
                    let errorMessage = enabled
                        ? "Failed to install XCBBuildService"
                        : "Failed to uninstall XCBBuildService";
                    if (
                        error
                            .toString()
                            .includes("PermissionError: [Errno 1] Operation not permitted:")
                    ) {
                        errorMessage += `: Permission denied. Make sure the password is correct and you gave a full disk control to VSCode in System Preferences -> Security & Privacy -> Privacy -> Full Disk Access.`;
                    } else if (error.toString().includes("Password:Sorry, try again.")) {
                        errorMessage += `: Wrong password provided.`;
                    }
                    vscode.window.showErrorMessage(errorMessage);
                } else {
                    if (enabled) {
                        vscode.window.showInformationMessage(
                            "XCBBuildService proxy setup successfully"
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            "XCBBuildService Proxy was uninstall successfully"
                        );
                    }
                }
                resolve();
            });
        });
    });
}

export async function openFile(
    filePath: string,
    lineNumber: number,
    viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active
) {
    const fileUri = vscode.Uri.file(path.resolve(filePath));
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document, viewColumn, false);
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
