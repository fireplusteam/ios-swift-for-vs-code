// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { cleanDerivedData } from "./clean";
import { getEnv } from "./env";
import {
  buildSelectedTarget,
  checkWorkspace,
  generateXcodeServer,
  selectTarget,
} from "./commands";
import { Executor, ExecutorRunningError } from "./execShell";

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
        await sleep(2000);
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
    vscode.commands.registerCommand("vscode-ios.project.selectTarget", () => {
      return selectTarget(projectExecutor);
    })
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
    vscode.commands.registerCommand("vscode-ios.clean.data", () => {
      return cleanDerivedData(projectExecutor);
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
}

// This method is called when your extension is deactivated
export function deactivate() {}
