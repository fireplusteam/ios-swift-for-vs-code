import * as vscode from "vscode";
import { getScriptPath } from "./env";
import { Executor } from "./execShell";

let isLaunching = false;

export async function startIOSDebugger() {
  await vscode.debug.stopDebugging();
    
  isLaunching = true;
  let debugSession: vscode.DebugConfiguration = {
    type: "lldb",
    request: "custom",
    name: "iOS App Debug",
    program: "${workspaceFolder}/your-program.js",
    targetCreateCommands: [
      `command script import '${getScriptPath()}/attach_lldb.py'`,
      "command script add -f attach_lldb.create_target create_target",
      "command script add -f attach_lldb.terminate_debugger terminate_debugger",
      "command script add -f attach_lldb.watch_new_process watch_new_process",
      "command script add -f attach_lldb.app_log app_log",
      "create_target",
    ],
    processCreateCommands: [
      "process handle SIGKILL -n true -p true -s false",
      "process handle SIGTERM -n true -p true -s false",
      "watch_new_process",
    ],
    exitCommands: [],
  };
  vscode.debug.startDebugging(undefined, debugSession);
}

export function endRunCommand() {
  isLaunching = false;
}

export function terminateIOSDebugger(name: string, executor: Executor) {
  if (name === "iOS App Debug" && isLaunching === true) {
    executor.terminateShell();
    isLaunching = false;
  }
}
