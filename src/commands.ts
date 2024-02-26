import * as vscode from 'vscode';
import { Executor, ExecutorMode, ExecutorReturnType } from "./execShell";
import { showPicker } from "./inputPicker";
import { getEnvList, getWorkspacePath, updateProject } from "./env";
import { buildSelectedTarget, getFileNameLog } from "./build";
import { emptyTestsLog, getLastLine, killSpawnLaunchedProcesses } from "./utils";
import * as path from 'path';
import { ProblemDiagnosticLogType, ProblemDiagnosticResolver } from './ProblemDiagnosticResolver';

export async function selectProjectFile(executor: Executor, ignoreFocusOut = false) {
  const include: vscode.GlobPattern = "{*.xcworkspace/contents.xcworkspacedata,*.xcodeproj/project.pbxproj,Package.swift}";
  const files = await vscode.workspace.findFiles(include);

  const options = files.map((file) => {
    if (file.fsPath.endsWith("Package.swift")) {
      const name = path.join(file.fsPath).split(path.sep);
      const projectPath = name.join(path.sep);
      return { label: name[name.length - 1], value: projectPath };
    }
    const name = path.join(file.fsPath, "..").split(path.sep);
    const projectPath = name.join(path.sep);
    return { label: name[name.length - 1], value: projectPath };
  });
  if (options.length == 0) {
    if (ignoreFocusOut == false) {
      vscode.window.showErrorMessage("Workspace doesn't have any iOS project or workspace file");
    }
    return;
  }
  const json = JSON.stringify(options);

  const selection = await showPicker(
    json,
    "Select Project File",
    "Please select your project file",
    false,
    ignoreFocusOut
  );
  if (selection === undefined || selection === '') {
    return;
  }
  updateProject(selection);
  await selectTarget(executor, true);
}

export async function storeVSConfig(executor: Executor) {
  const fileUrl = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (fileUrl === undefined) {
    throw new Error("In order to trigger a compile task for a file, select a file first please");
  }

  await executor.execShell("Store VS Config", "store_vs_config.sh", [fileUrl]);
}

export async function selectTarget(executor: Executor, ignoreFocusOut = false) {
  await checkWorkspace(executor, ignoreFocusOut);
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
    ignoreFocusOut
  );

  if (option === undefined) {
    return;
  }

  await executor.execShell(
    "Update Selected Target",
    "update_environment.sh",
    ["-destinationScheme", option]
  );
}

export async function selectDevice(executor: Executor, shouldCheckWorkspace = true, ignoreFocusOut = false) {
  if (shouldCheckWorkspace === true) {
    await checkWorkspace(executor);
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
    ignoreFocusOut
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

export async function checkWorkspace(executor: Executor, ignoreFocusOut = false) {
  await executor.execShell("Validate Environment", "check_workspace.sh");
  const env = getEnvList();
  if (!env.hasOwnProperty("DEVICE_ID")) {
    await selectDevice(executor, false, ignoreFocusOut);
  }
}

export async function generateXcodeServer(executor: Executor) {
  await checkWorkspace(executor);
  await executor.execShell(
    "Generate xCode Server",
    "build_autocomplete.sh"
  );
}

export async function terminateCurrentIOSApp(sessionID: string, executor: Executor) {
  await executor.execShell("Terminate Current iOS App", "terminate_current_running_app.sh", [sessionID]);
  await killSpawnLaunchedProcesses(sessionID);
}

export async function nameOfModuleForFile(executor: Executor) {
  const fileUrl = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (fileUrl === undefined) {
    throw new Error("In order to get a name of module for a file, select the file first please");
  }
  const moduleName = getLastLine(await executor.execShell(
    "Name Of Module By Current File",
    "module_name_by_file.sh",
    [fileUrl],
    false,
    ExecutorReturnType.stdout) as string
  );
  vscode.window.showInformationMessage(`Name of module is: ${moduleName}`);
}

export async function runApp(sessionID: string, executor: Executor, isDebuggable: boolean) {
  await executor.execShell(
    "Run App",
    "run_app.sh",
    [sessionID, isDebuggable ? "LLDB_DEBUG" : "RUNNING"],
    false
  );
}

let counterMultiDeviceRunner = 0;

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
    true
  );

  if (option === undefined || option === '') {
    return;
  }

  await buildSelectedTarget(executor, problemResolver);

  await terminateCurrentIOSApp(`${sessionID}${counterMultiDeviceRunner}`, executor);
  counterMultiDeviceRunner += 1;

  await executor.execShell(
    "Run App On Multiple Devices",
    "run_app.sh",
    [`${sessionID}${counterMultiDeviceRunner}`, "RUNNING", "-DEVICES", `${option}`],
    false
  );
}

export async function runAndDebugTests(sessionID: string, executor: Executor, problemResolver: ProblemDiagnosticResolver, isDebuggable: boolean) {
  const filePath = getFileNameLog(ProblemDiagnosticLogType.tests);
  problemResolver.parseAsyncLogs(getWorkspacePath(), filePath, ProblemDiagnosticLogType.tests);
  emptyTestsLog();
  await executor.execShell(
    "Run Tests",
    "test_app.sh",
    [sessionID, isDebuggable ? "DEBUG_LLDB" : "RUNNING", "-ALL"],
    false
  );
}

export async function runAndDebugTestsForCurrentFile(sessionID: string, executor: Executor, problemResolver: ProblemDiagnosticResolver, isDebuggable: boolean) {
  const filePath = getFileNameLog(ProblemDiagnosticLogType.tests);
  problemResolver.parseAsyncLogs(getWorkspacePath(), filePath, ProblemDiagnosticLogType.tests);
  emptyTestsLog();
  await executor.execShell(
    "Run Tests For Current File",
    "test_app.sh",
    [sessionID, isDebuggable ? "DEBUG_LLDB" : "RUNNING", "-CLASS", "CURRENTLY_SELECTED"],
    false
  );
}

