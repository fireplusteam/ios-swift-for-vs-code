import { exec } from 'child_process';
import { glob } from 'glob';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProblemDiagnosticResolver } from './ProblemDiagnosticResolver';
import { ProjectManager, getProjectFiles } from './ProjectManager/ProjectManager';
import { buildSelectedTarget } from "./buildCommands";
import { getDeviceId, getEnvList, getProjectConfiguration, getProjectFileName, getProjectPath, getProjectPlatform, getProjectScheme, getScriptPath, getWorkspacePath, getXCBBuildServicePath, updateProject } from "./env";
import { Executor, ExecutorMode, ExecutorReturnType } from "./execShell";
import { sleep } from './extension';
import { showPicker } from "./inputPicker";
import { emptyAppLog, getLastLine, isFolder, killSpawnLaunchedProcesses } from "./utils";

export async function selectProjectFile(executor: Executor, projectManager: ProjectManager, showProposalMessage = false, ignoreFocusOut = false) {
    const workspaceEnd = ".xcworkspace/contents.xcworkspacedata";
    const projectEnd = ".xcodeproj/project.pbxproj";
    const excludeEnd = ".xcodeproj/project.xcworkspace"
    const include: vscode.GlobPattern = `**/{*${workspaceEnd},*${projectEnd},Package.swift}`;
    const files = await glob(
        include,
        {
            absolute: true,
            cwd: getWorkspacePath(),
            nodir: true
        }
    );

    const options = files
        .filter(file => {
            if (file.endsWith(projectEnd)) {
                for (let checkFile of files) {
                    if (checkFile.endsWith(workspaceEnd) &&
                        checkFile.slice(0, -workspaceEnd.length) == file.slice(0, -projectEnd.length))
                        return false;
                }
            }
            return true;
        })
        .map((file) => {
            if (file.endsWith("Package.swift")) {
                const relativeProjectPath = path.relative(getWorkspacePath(), file)
                return { label: relativeProjectPath, value: file };
            }
            const relativeProjectPath = path.relative(getWorkspacePath(), file)
                .split(path.sep)
                .slice(0, -1)
                .join(path.sep);
            return { label: relativeProjectPath, value: file.split(path.sep).slice(0, -1).join(path.sep) };
        })
        .filter(file => {
            if (file.value.endsWith(excludeEnd))
                return false;
            return true;
        });
    if (options.length == 0) {
        if (showProposalMessage == false) {
            vscode.window.showErrorMessage("Workspace doesn't have any iOS project or workspace file");
        }
        return false;
    } else if (showProposalMessage) {
        const isAllowedToConfigure = await vscode.window.showInformationMessage("Workspace has iOS projects. Do you want to pick a project to configure?", "Yes", "No");
        if (isAllowedToConfigure !== "Yes")
            return false;
    }

    const selection = await showPicker(
        options,
        "Select Project File",
        "Please select your project file",
        false,
        ignoreFocusOut,
        true
    );
    if (selection === undefined || selection === '') {
        return false;
    }
    updateProject(selection);
    await executor.terminateShell();
    await projectManager.loadProjectFiles(true);
    await checkWorkspace(executor, true);
    return true;
}

export async function selectTarget(executor: Executor, ignoreFocusOut = false, shouldCheckWorkspace = true) {
    if (shouldCheckWorkspace) {
        const selected = await checkWorkspace(executor, ignoreFocusOut);
        if (selected.selectedTarget)
            return;
    }

    let stdout = getLastLine((await executor.execShell(
        "Fetch Project Targets",
        "populate_schemes.sh",
        [],
        false,
        ExecutorReturnType.stdout
    )) as string);

    let option = await showPicker(stdout,
        "Target",
        "Please select Target",
        false,
        ignoreFocusOut,
        true
    );

    if (option === undefined) {
        return;
    }

    await executor.execShell(
        "Update Selected Target",
        "update_environment.sh",
        ["-destinationScheme", option]
    );

    await checkWorkspace(executor);
}

export async function selectConfiguration(executor: Executor, ignoreFocusOut = false, shouldCheckWorkspace = true) {
    if (shouldCheckWorkspace) {
        const selected = await checkWorkspace(executor, ignoreFocusOut);
        if (selected.selectedConfiguration)
            return;
    }

    let stdout = getLastLine((await executor.execShell(
        "Fetch Project Configurations",
        "populate_configurations.sh",
        [ // TODO: Need to figure out if we can pass ProjectManager here
            getProjectFiles(getProjectPath()).at(0) || "Debug"
        ],
        false,
        ExecutorReturnType.stdout
    )) as string);

    let option = await showPicker(stdout,
        "Configuration",
        "Please Select Build Configuration",
        false,
        ignoreFocusOut,
        true
    );

    if (option === undefined) {
        return;
    }

    await executor.execShell(
        "Update Selected Configuration",
        "update_environment.sh",
        ["-destinationConfiguration", option]
    );
}

export async function selectDevice(executor: Executor, shouldCheckWorkspace = true, ignoreFocusOut = false) {
    if (shouldCheckWorkspace === true) {
        const selected = await checkWorkspace(executor);
        if (selected.selectedDevice)
            return;
    }
    let stdout = getLastLine((await executor.execShell(
        "Fetch Devices",
        "populate_devices.sh",
        ["-single"],
        false,
        ExecutorReturnType.stdout,
    )) as string);

    let option = await showPicker(
        stdout,
        "Device",
        "Please select Device for DEBUG",
        false,
        ignoreFocusOut,
        true
    );

    if (option === undefined) {
        return false;
    }

    return await executor.execShell(
        "Update DEBUG Device",
        "update_environment.sh",
        ["-destinationDevice", option]
    );
}

export async function restartLSP() {
    await vscode.commands.executeCommand("swift.restartLSPServer");
}

export async function checkWorkspace(executor: Executor, ignoreFocusOut = false) {
    let selectedConfiguration = false;
    try {
        if (getProjectConfiguration().length == 0) {
            await selectConfiguration(executor, true, false);
            selectedConfiguration = true;
        }
    } catch {
        await selectConfiguration(executor, true, false);
        selectedConfiguration = true;
    }

    let selectedTarget = false;
    try {
        if (getProjectScheme().length == 0) {
            await selectTarget(executor, true, false);
            selectedTarget = true;
        }
    } catch {
        await selectTarget(executor, true, false);
        selectedTarget = true;
    }


    const command = getLastLine(await executor.execShell(
        "Validate Environment",
        "check_workspace.sh",
        [],
        false,
        ExecutorReturnType.stdout
    ) as string);
    if (command === "Restarting LSP") {
        restartLSP();
    }

    const env = getEnvList();
    let selectedDevice = false;
    if (!env.hasOwnProperty("DEVICE_ID") || !env.hasOwnProperty("PLATFORM")) {
        await selectDevice(executor, false, ignoreFocusOut);
        selectedDevice = true;
    }

    return { selectedTarget: selectedTarget, selectedConfiguration: selectedConfiguration, selectedDevice: selectedDevice };
}

export async function generateXcodeServer(executor: Executor) {
    await checkWorkspace(executor);
    await executor.execShell(
        "Generate xCode Server",
        "build_autocomplete.sh"
    );
}

export async function openXCode(activeFile: string) {
    const openExec = new Executor();
    const stdout = await openExec.execShell(
        "Open Xcode",
        "open_xcode.sh",
        [getProjectPath()],
        false,
        ExecutorReturnType.stdout,
        ExecutorMode.silently
    ) as string;
    console.log(stdout);
    if (!isFolder(activeFile)) {
        exec(`open -a Xcode ${activeFile}`);
    }
}

export async function terminateCurrentIOSApp(sessionID: string, executor: Executor, silent = false) {
    await executor.execShell(
        "Terminate Current iOS App",
        "terminate_current_running_app.sh",
        [sessionID],
        false,
        ExecutorReturnType.statusCode,
        silent ? ExecutorMode.silently : ExecutorMode.verbose
    );
    await killSpawnLaunchedProcesses(sessionID);
}

export async function runApp(sessionID: string, executor: Executor, isDebuggable: boolean) {
    emptyAppLog(getDeviceId());
    await executor.execShell(
        "Run App",
        "run_app.sh",
        [sessionID, isDebuggable ? "LLDB_DEBUG" : "RUNNING"],
        false
    );
}

export async function runAppOnMultipleDevices(sessionID: string, executor: Executor, problemResolver: ProblemDiagnosticResolver) {
    let stdout = getLastLine((await executor.execShell(
        "Fetch Multiple Devices",
        "populate_devices.sh",
        ["-multi"],
        false,
        ExecutorReturnType.stdout
    )) as string);

    let option = await showPicker(
        stdout,
        "Devices",
        "Please select Multiple Devices to Run You App",
        true,
        false,
        true
    );

    if (option === undefined || option === '') {
        return;
    }

    await buildSelectedTarget(executor, problemResolver);
    await terminateCurrentIOSApp(sessionID, executor);

    for (let device of option.split(" ")) {
        emptyAppLog(device.substring("id=".length));
    }
    await executor.execShell(
        "Run App On Multiple Devices",
        "run_app.sh",
        [sessionID, "RUNNING", "-DEVICES", `${option}`],
        false
    );
}

export async function runAndDebugTests(sessionID: string, executor: Executor, isDebuggable: boolean) {
    await executor.execShell(
        "Run Tests",
        "test_app.sh",
        [sessionID, isDebuggable ? "DEBUG_LLDB" : "RUNNING", "-ALL"],
        false
    );
}

export async function runAndDebugTestsForCurrentFile(sessionID: string, executor: Executor, isDebuggable: boolean, tests: string[]) {
    const option = tests.map(e => {
        return `-only-testing:${e}`;
    }).join(" ");
    await executor.execShell(
        "Run Tests For Current File",
        "test_app.sh",
        [sessionID, isDebuggable ? "DEBUG_LLDB" : "RUNNING", "-SELECTED", option],
        false
    );
}

export async function enableXCBBuildService(enabled: boolean) {
    await sleep(5000);
    const checkIfInjectedCommand = `python3 ${getScriptPath("xcode_service_setup.py")} -isProxyInjected`;

    return new Promise<void>(async (resolve) => {
        exec(checkIfInjectedCommand, async (error, stdout, stderr) => {
            if (enabled && error === null || !enabled && error != null) {
                resolve();
                return;
            }
            const isInstallStr = enabled ? "INSTALL" : "DISABLED";
            const password = await vscode.window.showInputBox({ ignoreFocusOut: false, prompt: `In order to ${isInstallStr} XCBBuildService, please enter sudo password`, password: true });
            if (password === undefined) {
                resolve();
                return;
            }
            const install = enabled ? "-install" : "-uninstall"
            const command = `echo '${password}' | sudo -S python3 ${getScriptPath("xcode_service_setup.py")} ${install} ${getXCBBuildServicePath()}`;
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    if (enabled)
                        vscode.window.showErrorMessage(`Failed to install XCBBuildService`);
                    else
                        vscode.window.showErrorMessage(`Failed to uninstall XCBBuildService`);
                } else {
                    if (enabled)
                        vscode.window.showInformationMessage("XCBBuildService proxy setup successfully");
                    else
                        vscode.window.showInformationMessage("XCBBuildService Proxy was uninstall successfully")
                }
                resolve();
            });
        });
    });
}

export async function openFile(filePath: string, lineNumber: number) {
    const fileUri = vscode.Uri.file(path.resolve(filePath));
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.Active, false);
    editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
    await vscode.commands.executeCommand("cursorMove", {
        to: "down",
        select: false,
        by: "line",
        value: lineNumber
    });
}

// diff
export async function ksdiff(name: string, path1: string, path2: string) {
    const filePrefix = "file://";
    if (path1.startsWith(filePrefix))
        path1 = path1.slice(filePrefix.length);
    if (path2.startsWith(filePrefix))
        path2 = path2.slice(filePrefix.length);
    vscode.commands.executeCommand("vscode.diff", vscode.Uri.file(path1), vscode.Uri.file(path2), name);
}