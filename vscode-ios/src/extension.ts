// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { cleanDerivedData } from "./clean";
import { getEnv, getScriptPath } from "./env";
import {
  buildSelectedTarget,
  checkWorkspace,
  generateXcodeServer,
  runApp,
  selectDevice,
  selectTarget,
} from "./commands";
import { Executor, ExecutorRunningError } from "./execShell";
import { endRunCommand, startIOSDebugger, terminateIOSDebugger } from "./debugger";

function initialize() {}

const projectExecutor = new Executor();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function commandWrapper(commandClosure: () => Promise<void>) {
  try {
    await commandClosure();
  } catch (err) {
    if (err instanceof ExecutorRunningError) {
      const choice = await vscode.window.showErrorMessage(
        "To execute this task you need to terminate the current task. Do you want to terminate it to continue?",
        "Terminate",
        "Cancel"
      );
      if (choice === "Terminate") {
        projectExecutor.terminateShell();
        await sleep(1500); // 1.5 seconds
        commandClosure();
      }
    }
  }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "vscode-ios" is now active!');

  initialize();
  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.env.scriptPath",
      async () => {
        console.log("DEBUG STARTED: " + getScriptPath());
        return getScriptPath();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.project.selectTarget",
      async () => {
        await commandWrapper(async () => {
          await selectTarget(projectExecutor);
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.project.selectDevice",
      async () => {
        await commandWrapper(async () => {
          await selectDevice(projectExecutor);
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.check.workspace", async () => {
      await commandWrapper(async () => {
        await checkWorkspace(projectExecutor);
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.check.generateXcodeServer",
      async () => {
        await commandWrapper(async () => {
          await generateXcodeServer(projectExecutor);
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.build.clean", async () => {
      await commandWrapper(async () => {
        await cleanDerivedData(projectExecutor);
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.build.selectedTarget",
      async () => {
        await commandWrapper(async () => {
          await buildSelectedTarget(projectExecutor);
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.run.app", async () => {
      await commandWrapper(async () => {
        await runApp(projectExecutor);
      });
      return ""; // we need to return string as it's going to be used for launch configuration
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.run.app.debug", async () => {
      await commandWrapper(async () => {
        startIOSDebugger();
        await runApp(projectExecutor);
      });
      endRunCommand();
      return ""; // we need to return string as it's going to be used for launch configuration
    })
  );

  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession((session) => {
      terminateIOSDebugger(session.name, projectExecutor);
    })
  );

  context.subscriptions.push(
    vscode.debug.onDidChangeActiveDebugSession((session) => {
      console.log("ok");
    })
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
