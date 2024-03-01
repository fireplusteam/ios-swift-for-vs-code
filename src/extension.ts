// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { isActivated } from "./env";
import {
  checkWorkspace,
  generateXcodeServer,
  nameOfModuleForFile,
  openXCode,
  restartLSP,
  runAppOnMultipleDevices,
  selectDevice,
  selectProjectFile,
  selectTarget,
} from "./commands";
import { Executor } from "./execShell";
import { BuildTaskProvider, executeTask } from "./BuildTaskProvider";
import { DebugConfigurationProvider } from "./DebugConfigurationProvider";
import { runCommand } from "./commandWrapper";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { askIfDebuggable } from "./inputPicker";
import { getSessionId } from "./utils";
import { AutocompleteWatcher } from "./AutocompleteWatcher";
import { ProjectManager } from "./ProjectManager";

async function initialize() {
  if (!isActivated()) {
    try {
      await selectProjectFile(projectExecutor, projectManager, true);
    } catch {
      vscode.window.showErrorMessage("Project was not loaded due to error");
    }
  } else {
    restartLSP();
  }
}

export const projectExecutor = new Executor();
export const problemDiagnosticResolver = new ProblemDiagnosticResolver();
export const debugConfiguration = new DebugConfigurationProvider(projectExecutor, problemDiagnosticResolver);
const projectManager = new ProjectManager();
const autocompleteWatcher = new AutocompleteWatcher(
  projectExecutor,
  problemDiagnosticResolver,
  projectManager
);

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  initialize();

  let logChannel = vscode.window.createOutputChannel("VSCode-iOS");
  context.subscriptions.push(
    logChannel
  );
  logChannel.appendLine("Activated");
  logChannel.show();

  context.subscriptions.push(projectManager.onProjectUpdate.event(e => {
    autocompleteWatcher.triggerIncrementalBuild();
  }));

  context.subscriptions.push(
    vscode.tasks.registerTaskProvider(BuildTaskProvider.BuildScriptType, new BuildTaskProvider(projectExecutor, problemDiagnosticResolver))
  );

  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(DebugConfigurationProvider.Type, debugConfiguration)
  );

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.project.select", async () => {
      try {
        await selectProjectFile(projectExecutor, projectManager);
      } catch {
        vscode.window.showErrorMessage("Project was not loaded due to error");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.env.open.xcode", async () => {
      openXCode();
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
      await executeTask("Clean Derived Data");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.build.selectedTarget",
      async () => {
        await executeTask("Build Selected Target");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.build.currentFile",
      async () => {
        await executeTask("Build: Current File");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.build.all",
      async () => {
        await executeTask("Build All");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.build.tests",
      async () => {
        await executeTask("Build Tests");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.build.tests.currentFile",
      async () => {
        await executeTask("Build Tests: Current File");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-ios.utils.file.nameOfModule",
      async () => {
        await runCommand(async () => {
          await nameOfModuleForFile(new Executor());
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.run.app.multiple.devices", async () => {
      await runCommand(async () => {
        const id = getSessionId("multiple_devices");
        await runAppOnMultipleDevices(id, projectExecutor, problemDiagnosticResolver);
      });
      return ""; // we need to return string as it's going to be used for launch configuration
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.run.app.debug", async () => {
      const isDebuggable = await askIfDebuggable();
      await debugConfiguration.startIOSDebugger(isDebuggable);
      return true;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.run.tests.debug", async () => {
      const isDebuggable = await askIfDebuggable();
      await debugConfiguration.startIOSTestsDebugger(isDebuggable);
      return true;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.run.tests.currentFile.debug", async () => {
      const isDebuggable = await askIfDebuggable();
      await debugConfiguration.startIOSTestsForCurrentFileDebugger(isDebuggable);
      return true;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.run.project.add.file", async () => {
      projectManager.addAFileToXcodeProject(vscode.window.activeTextEditor?.document.uri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-ios.run.project.reload", async () => {
      try {
        await projectManager.loadProjectFiles();
      } catch {
        vscode.window.showErrorMessage("Project was not reloaded due to error");
      }
    })
  );
}

// This method is called when your extension is deactivated
export function deactivate() { }
