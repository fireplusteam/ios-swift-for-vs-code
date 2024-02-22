import { Executor, ExecutorReturnType } from "./execShell";
import { showPicker } from "./inputPicker";
import { getEnvList } from "./env";
import { buildSelectedTarget } from "./build";
import { getLastLine } from "./utils";

export async function selectTarget(executor: Executor) {
  await checkWorkspace(executor);
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
  );

  if (option === undefined) {
    return;
  }

  await executor.execShell(
    "Update Selected Target",
    "update_enviroment.sh",
    ["-destinationScheme", option]
  );
}

export async function selectDevice(executor: Executor, shouldCheckWorkspace = true) {
  if (shouldCheckWorkspace === true) {
    await checkWorkspace(executor);
  }
  let stdout = getLastLine((await executor.execShell(
    "Fetch Devices",
    "populate_devices.sh",
    ["-single"],
    false,
    ExecutorReturnType.stdout
  )) as string);

  let option = await showPicker(
    stdout,
    "Device",
    "Please select Device for DEBUG",
    false
  );

  if (option === undefined) {
    return false;
  }

  return await executor.execShell(
    "Update DEBUG Device",
    "update_enviroment.sh",
    ["-destinationDevice", option]
  );
}

export async function checkWorkspace(executor: Executor) {
  await executor.execShell("Validate Environment", "check_workspace.sh");
  const env = getEnvList();
  if (!env.hasOwnProperty("DEVICE_ID")) {
    await selectDevice(executor, false);
  }
}

export async function generateXcodeServer(executor: Executor) {
  await checkWorkspace(executor);
  await executor.execShell(
    "Generate xCode Server",
    "build_autocomplete.sh"
  );
}

export async function terminateCurrentIOSApp(executor: Executor) {
  await executor.execShell("Terminate Current iOS App", "terminate_current_running_app.sh");
}

export async function runApp(executor: Executor) {
  await terminateCurrentIOSApp(executor);
  await buildSelectedTarget(executor);
  await executor.execShell(
    "Run App",
    "run_app.sh",
    ["RUNNING"],
    false
  );
}

export async function runAppAndDebug(executor: Executor) {
  await terminateCurrentIOSApp(executor);
  await executor.execShell(
    "Run App",
    "run_app.sh",
    ["LLDB_DEBUG"],
    false
  );
}

export async function runAppOnMultipleDevices(executor: Executor) {
  await terminateCurrentIOSApp(executor);

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

  await buildSelectedTarget(executor);

  await executor.execShell(
    "Run App On Multiple Devices",
    "run_app.sh",
    ["RUNNING", "-DEVICES", `${option}`],
    false
  );
}
