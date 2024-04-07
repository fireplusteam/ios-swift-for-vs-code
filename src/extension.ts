// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { isActivated } from "./env";
import {
    checkWorkspace,
    enableXCBBuildService,
    generateXcodeServer,
    ksdiff,
    openFile,
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
import { askIfDebuggable, setContext } from "./inputPicker";
import { getSessionId } from "./utils";
import { AutocompleteWatcher } from "./AutocompleteWatcher";
import { ProjectManager } from "./ProjectManager/ProjectManager";
import { TestProvider } from "./TestsProvider/TestProvider";
import path from "path";

function shouldInjectXCBBuildService() {
    const isEnabled = vscode.workspace.getConfiguration("vscode-ios").get("xcb.build.service");
    if (!isEnabled) {
        return false;
    }
    return true;
}

async function initialize() {
    if (!isActivated()) {
        try {
            if (await selectProjectFile(projectExecutor, projectManager, true, true)) {
                await enableXCBBuildService(shouldInjectXCBBuildService());
                autocompleteWatcher.triggerIncrementalBuild();
            }
        } catch {
            vscode.window.showErrorMessage("Project was not loaded due to error");
        }
    } else {
        restartLSP();
        await enableXCBBuildService(shouldInjectXCBBuildService());
        autocompleteWatcher.triggerIncrementalBuild();
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

const testProvider = new TestProvider(projectManager, async (tests, isDebuggable) => {
    if (tests) {
        return await debugConfiguration.startIOSTestsForCurrentFileDebugger(tests, isDebuggable);
    } else {
        return await debugConfiguration.startIOSTestsDebugger(isDebuggable);
    }
});

export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    setContext(context);

    initialize();

    testProvider.activateTests(context);

    let logChannel = vscode.window.createOutputChannel("VSCode-iOS");
    context.subscriptions.push(
        logChannel
    );
    logChannel.appendLine("Activated");
    logChannel.show();

    context.subscriptions.push(projectManager.onProjectUpdate.event(e => {
        autocompleteWatcher.triggerIncrementalBuild();
    }));

    context.subscriptions.push(projectManager.onProjectLoaded.event(e => {
        testProvider.initialize();
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
                autocompleteWatcher.triggerIncrementalBuild();
            } catch {
                vscode.window.showErrorMessage("Project was not loaded due to error");
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.ksdiff", async (name: string, path1: string, path2: string) => {
            ksdiff(name, path1, path2);
        })
    );

    vscode.commands.registerCommand("vscode-ios.openFile", async (filePath: string, line: string) => {
        const lineNumber = Number(line) - 1;
        openFile(filePath, lineNumber);
    });

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.env.open.xcode", async (contextSelection: vscode.Uri, allSelections: vscode.Uri[]) => {
            if (contextSelection) {
                openXCode(contextSelection.fsPath);
            } else {
                openXCode(vscode.window.activeTextEditor?.document.uri.fsPath || "");
            }
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
                await executeTask("Build");
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
        vscode.commands.registerCommand("vscode-ios.project.file.add", async (contextSelection: vscode.Uri, allSelections: vscode.Uri[]) => {
            const files = await vscode.window.showOpenDialog({
                defaultUri: contextSelection,
                openLabel: "Add",
                canSelectFiles: true,
                canSelectFolders: true,
                canSelectMany: true,
                filters: {
                    "All Files": ["*"]
                }
            });
            projectManager.addAFileToXcodeProject(files);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.project.delete.reference", async (contextSelection: vscode.Uri, allSelections: vscode.Uri[]) => {
            projectManager.deleteFileFromXcodeProject(allSelections);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.project.file.edit.targets", async (contextSelection: vscode.Uri, allSelections: vscode.Uri[]) => {
            projectManager.editFileTargets(contextSelection || vscode.window.activeTextEditor?.document.uri);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.run.project.reload", async () => {
            try {
                await projectManager.loadProjectFiles(true);
            } catch {
                vscode.window.showErrorMessage("Project was not reloaded due to error");
            }
        })
    );
}

// This method is called when your extension is deactivated
export function deactivate() { }
