// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { getScriptPath } from "./env";
import {
  checkWorkspace,
  generateXcodeServer,
  runApp,
  runAppOnMultipleDevices,
  selectDevice,
  selectTarget,
} from "./commands";
import { buildAllTarget, buildCurrentFile, buildSelectedTarget, buildTests, cleanDerivedData } from "./build";
import { Executor } from "./execShell";
import { BuildTaskProvider } from "./BuildTaskProvider";
import { DebugConfigurationProvider } from "./DebugConfigurationProvider";
import { runCommand } from "./commandWrapper";

function initialize() { }

export const projectExecutor = new Executor();
export const debugConfiguration = new DebugConfigurationProvider(projectExecutor);

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
  let logChannel = vscode.window.createOutputChannel("VSCode-iOS");
  context.subscriptions.push(
    logChannel
  );
  logChannel.appendLine("Activated");
  logChannel.show();

  context.subscriptions.push(
    vscode.tasks.registerTaskProvider(BuildTaskProvider.BuildScriptType, new BuildTaskProvider(projectExecutor))
  );

  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(DebugConfigurationProvider.Type, debugConfiguration)
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
        await runCommand(async () => {
          await selectTarget(projectExecutor);
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.project.selectDevice",
      async () => {
        await runCommand(async () => {
          await selectDevice(projectExecutor);
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.check.workspace", async () => {
      await runCommand(async () => {
        await checkWorkspace(projectExecutor);
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.check.generateXcodeServer",
      async () => {
        await runCommand(async () => {
          await generateXcodeServer(projectExecutor);
        });
      }
    )
  );
 
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.build.clean", async () => {
      await runCommand(async () => {
        await cleanDerivedData(projectExecutor);
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.build.selectedTarget",
      async () => {
        await runCommand(async () => {
          await buildSelectedTarget(projectExecutor);
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.build.currentFile",
      async () => {
        await runCommand(async () => {
          await buildCurrentFile(projectExecutor);
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.build.all",
      async () => {
        await runCommand(async () => {
          await buildAllTarget(projectExecutor);
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.build.tests",
      async () => {
        await runCommand(async () => {
          await buildTests(projectExecutor);
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.run.app", async () => {
      await runCommand(async () => {
        await runApp(projectExecutor);
      });
      return ""; // we need to return string as it's going to be used for launch configuration
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.run.app.multiple.devices", async () => {
      await runCommand(async () => {
        await runAppOnMultipleDevices(projectExecutor);
      });
      return ""; // we need to return string as it's going to be used for launch configuration
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.run.app.debug", async () => {
      debugConfiguration.startIOSDebugger(); 
      return true;
    })
  );

}

// This method is called when your extension is deactivated
export function deactivate() { }
