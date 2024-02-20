// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { buildOptions, cleanDerivedData } from "./build";
import { getEnv, getScriptPath } from "./env";
import {
  checkWorkspace,
  generateXcodeServer,
  runApp,
  selectDevice,
  selectTarget,
} from "./commands";
import { buildSelectedTarget } from "./build";
import { Executor } from "./execShell";
import {
  endRunCommand,
  startIOSDebugger,
  terminateIOSDebugger,
} from "./debugger";
import { BuildTaskProvider } from "./BuildTaskProvider";
import { commandWrapper } from "./commandWrapper";

function initialize() {}

export const projectExecutor = new Executor();

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "vscode-ios" is now active!');

  initialize();

  context.subscriptions.push(
    vscode.tasks.registerTaskProvider("vscode-ios-tasks", new BuildTaskProvider(projectExecutor))
  );

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.env.scriptPath", async () => {
      console.log("DEBUG STARTED: " + getScriptPath());
      return getScriptPath();
    })
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
    vscode.commands.registerCommand("vscode-ios.build.options", async () => {
      await commandWrapper(async () => {
        await buildOptions(projectExecutor);
      });
    })
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
}

// This method is called when your extension is deactivated
export function deactivate() {}
