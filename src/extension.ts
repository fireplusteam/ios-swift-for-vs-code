// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import {
    DebugDeviceIDMissedError,
    getFilePathInWorkspace,
    isActivated,
    isWorkspaceOpened,
    ProjectConfigurationMissedError,
    ProjectFileMissedError,
    ProjectSchemeMissedError,
} from "./env";
import {
    checkWorkspace,
    enableXCBBuildService,
    generateXcodeServer,
    ksdiff,
    openFile,
    openXCode,
    runAppOnMultipleDevices,
    selectConfiguration,
    selectDevice,
    selectProjectFile,
    selectTarget,
    selectTestPlan,
    updatePackageDependencies,
} from "./commands";
import { BuildTaskProvider, executeTask } from "./BuildTaskProvider";
import { DebugConfigurationProvider } from "./Debug/DebugConfigurationProvider";
import { ProblemDiagnosticResolver } from "./ProblemDiagnosticResolver";
import { askIfDebuggable, initializeWithError, setContext } from "./inputPicker";
import { deleteFile, emptyLog, getSessionId } from "./utils";
import { AutocompleteWatcher } from "./AutocompleteWatcher";
import { ProjectManager } from "./ProjectManager/ProjectManager";
import { TestProvider } from "./TestsProvider/TestProvider";
import { ToolsManager } from "./Tools/ToolsManager";
import { AtomicCommand } from "./CommandManagement/AtomicCommand";
import { RuntimeWarningsLogWatcher } from "./XcodeSideTreePanel/RuntimeWarningsLogWatcher";
import { RuntimeWarningsDataProvider } from "./XcodeSideTreePanel/RuntimeWarningsDataProvider";
import { LLDBDapDescriptorFactory } from "./Debug/LLDBDapDescriptorFactory";
import { DebugAdapterTrackerFactory } from "./Debug/DebugAdapterTrackerFactory";
import * as fs from "fs";
import { CommandContext } from "./CommandManagement/CommandContext";
import { SwiftLSPClient } from "./LSP/SwiftLSPClient";
import { TestTreeContext } from "./TestsProvider/TestTreeContext";
import { LSPTestsProvider } from "./LSP/LSPTestsProvider";
import { WorkspaceContextImp } from "./LSP/WorkspaceContext";
import { activateNotActiveExtension } from "./nonActiveExtension";
import { getReadOnlyDocumentProvider } from "./LSP/ReadOnlyDocumentProvider";
import { XCTestRunInspector } from "./Debug/XCTestRunInspector";

function shouldInjectXCBBuildService() {
    const isEnabled = vscode.workspace.getConfiguration("vscode-ios").get("xcb.build.service");
    if (!isEnabled) {
        return false;
    }
    return true;
}

async function initialize(
    atomicCommand: AtomicCommand,
    projectManager: ProjectManager,
    autocompleteWatcher: AutocompleteWatcher,
    lsp: SwiftLSPClient
) {
    if ((await isActivated()) === false) {
        try {
            let result: boolean | undefined;
            if ((await isWorkspaceOpened()) === false) {
                await atomicCommand.userCommand(async context => {
                    if ((await selectProjectFile(context, projectManager, true, true)) === false) {
                        result = false;
                    }
                }, undefined);
            }
            if (result === false) {
                return false;
            }
        } catch (error) {
            vscode.window.showErrorMessage("Project was not loaded due to error");
            return false;
        }
    }

    emptyLog(".vscode/xcode/debugger.launching");
    try {
        await atomicCommand.userCommand(async context => {
            await checkWorkspace(context, true);
        }, "Initialize");
    } catch (error) {
        await initializeWithError(error);
        // try to regenerate xcode build server, if it fails, let extension activate as it can be done later
    }
    lsp.start();
    await enableXCBBuildService(shouldInjectXCBBuildService());
    await projectManager.loadProjectFiles();
    autocompleteWatcher.triggerIncrementalBuild();
    return true;
}

const logChannel = vscode.window.createOutputChannel("VSCode-iOS");
const problemDiagnosticResolver = new ProblemDiagnosticResolver();
const workspaceContext = new WorkspaceContextImp(problemDiagnosticResolver);
const sourceLsp = new SwiftLSPClient(workspaceContext, logChannel);
const atomicCommand = new AtomicCommand(sourceLsp);

let debugConfiguration: DebugConfigurationProvider;
let projectManager: ProjectManager | undefined;
let autocompleteWatcher: AutocompleteWatcher | undefined;
let testProvider: TestProvider | undefined;

const runtimeWarningsDataProvider = new RuntimeWarningsDataProvider();
const runtimeWarningLogWatcher = new RuntimeWarningsLogWatcher(runtimeWarningsDataProvider);

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    fs.mkdir(getFilePathInWorkspace(".logs"), () => {});

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    context.subscriptions.push(logChannel);
    logChannel.appendLine("Activated");

    const tools = new ToolsManager(logChannel);
    await tools.resolveThirdPartyTools();

    projectManager = new ProjectManager();
    projectManager.onUpdateDeps = async () => {
        await tools.updateThirdPartyTools();
    };
    autocompleteWatcher = new AutocompleteWatcher(
        atomicCommand,
        problemDiagnosticResolver,
        projectManager
    );

    // initialise code

    setContext(context);

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.project.select", async () => {
            try {
                await atomicCommand.userCommandWithoutThrowingException(async context => {
                    if (projectManager === undefined) {
                        throw Error("Project Manager is not initialized");
                    }
                    await selectProjectFile(context, projectManager);
                    autocompleteWatcher?.triggerIncrementalBuild();
                }, "Select Project");
            } catch {
                vscode.window.showErrorMessage("Project was not loaded due to error");
            }
        })
    );

    if (
        (await initialize(atomicCommand, projectManager, autocompleteWatcher, sourceLsp)) === false
    ) {
        vscode.commands.executeCommand("setContext", "vscode-ios.activated", false);
        // only available task to activate extension
        activateNotActiveExtension(context);
        return;
    }

    context.subscriptions.push(getReadOnlyDocumentProvider());

    vscode.commands.executeCommand("setContext", "vscode-ios.activated", true);

    vscode.window.registerTreeDataProvider("RuntimeWarningsProvider", runtimeWarningsDataProvider);

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory(
            "xcode-lldb",
            new LLDBDapDescriptorFactory()
        )
    );
    const debugAdapterFactory = new DebugAdapterTrackerFactory(problemDiagnosticResolver);
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterTrackerFactory("xcode-lldb", debugAdapterFactory)
    );
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterTrackerFactory("lldb", debugAdapterFactory)
    );
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterTrackerFactory("debugpy", debugAdapterFactory)
    );

    debugConfiguration = new DebugConfigurationProvider(
        workspaceContext,
        runtimeWarningLogWatcher,
        new XCTestRunInspector(problemDiagnosticResolver),
        atomicCommand
    );

    testProvider = new TestProvider(
        projectManager,
        new TestTreeContext(new LSPTestsProvider(sourceLsp), atomicCommand),
        async (tests, isDebuggable, testRun, context, isCoverage) => {
            return await debugConfiguration.startIOSTestsDebugger(
                tests,
                isDebuggable,
                testRun,
                context,
                isCoverage
            );
        }
    );
    if (await isActivated()) {
        testProvider.activateTests(context);
    }

    context.subscriptions.push(
        projectManager.onProjectUpdate.event(() => {
            autocompleteWatcher?.triggerIncrementalBuild();
        })
    );

    context.subscriptions.push(
        projectManager.onProjectLoaded.event(() => {
            testProvider?.initialize();
        })
    );

    context.subscriptions.push(
        vscode.tasks.registerTaskProvider(
            BuildTaskProvider.BuildScriptType,
            new BuildTaskProvider(problemDiagnosticResolver, atomicCommand)
        )
    );

    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider(
            DebugConfigurationProvider.Type,
            debugConfiguration
        )
    );

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.tools.install", async () => {
            await tools.resolveThirdPartyTools(true);
            await vscode.window.showInformationMessage(
                "All Dependencies are installed successfully!"
            );
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.tools.update", async () => {
            await tools.updateThirdPartyTools();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.lsp.restart", async () => {
            await sourceLsp.restart();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.ksdiff",
            async (name: string, path1: string, path2: string) => {
                ksdiff(name, path1, path2);
            }
        )
    );

    vscode.commands.registerCommand(
        "vscode-ios.openFile",
        async (filePath: string, line: string) => {
            const lineNumber = Number(line) - 1;
            openFile(filePath, lineNumber);
        }
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.env.open.xcode",
            async (contextSelection: vscode.Uri) => {
                if (contextSelection) {
                    openXCode(contextSelection.fsPath);
                } else {
                    openXCode(vscode.window.activeTextEditor?.document.uri.fsPath || "");
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.project.selectTarget", async () => {
            await atomicCommand.userCommandWithoutThrowingException(async context => {
                await selectTarget(context);
            }, "Select Target");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.project.selectConfiguration", async () => {
            await atomicCommand.userCommandWithoutThrowingException(async context => {
                await selectConfiguration(context);
            }, "Select Configuration");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.project.selectTestPlan", async () => {
            await atomicCommand.userCommandWithoutThrowingException(async context => {
                await selectTestPlan(context);
            }, "Select Test Plan");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.project.selectDevice", async () => {
            await atomicCommand.userCommandWithoutThrowingException(async context => {
                await selectDevice(context);
            }, "Select DEBUG Device");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.check.workspace", async () => {
            await atomicCommand.userCommandWithoutThrowingException(async context => {
                await checkWorkspace(context);
            }, "Validate Workspace");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.check.generateXcodeServer", async () => {
            await atomicCommand.userCommandWithoutThrowingException(async context => {
                await generateXcodeServer(context);
            }, "Generate Xcode Build Server");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.build.clean", async () => {
            await executeTask("Clean Derived Data");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.build.selectedTarget", async () => {
            await executeTask("Build");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.build.tests", async () => {
            await executeTask("Build Tests");
        })
    );

    let multiDevicesSessionCounter = 1;
    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.run.app.multiple.devices", async () => {
            await atomicCommand.userCommandWithoutThrowingException(async context => {
                const id = getSessionId(`multiple_devices`) + `_${multiDevicesSessionCounter}`;
                multiDevicesSessionCounter++;
                await runAppOnMultipleDevices(context, id, problemDiagnosticResolver);
            }, "Run On Multiple Devices");
            return ""; // we need to return string as it's going to be used for launch configuration
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.run.app.debug", async () => {
            const isDebuggable = await askIfDebuggable();
            atomicCommand.userCommand(async context => {
                await debugConfiguration.startIOSDebugger(isDebuggable, context);
            }, "Start Debug");
            return true;
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.project.file.add",
            async (contextSelection: vscode.Uri) => {
                const files = await vscode.window.showOpenDialog({
                    defaultUri: contextSelection,
                    openLabel: "Add",
                    canSelectFiles: true,
                    canSelectFolders: true,
                    canSelectMany: true,
                    filters: {
                        "All Files": ["*"],
                    },
                });
                projectManager?.addAFileToXcodeProject(files);
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.project.delete.reference",
            async (contextSelection: vscode.Uri, allSelections: vscode.Uri[]) => {
                projectManager?.deleteFileFromXcodeProject(allSelections);
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.project.file.edit.targets",
            async (contextSelection: vscode.Uri) => {
                projectManager?.editFileTargets(
                    contextSelection || vscode.window.activeTextEditor?.document.uri
                );
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.run.project.reload", async () => {
            try {
                await projectManager?.loadProjectFiles(true);
            } catch {
                vscode.window.showErrorMessage("Project was not reloaded due to error");
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.run.project.update.deps", async () => {
            atomicCommand.userCommand(async context => {
                await updatePackageDependencies(context);
            }, "Update Package Dependencies");
        })
    );
}

// This method is called when your extension is deactivated
export async function deactivate() {
    autocompleteWatcher?.terminate();
    atomicCommand.cancel();
    runtimeWarningLogWatcher.disposeWatcher();
    deleteFile(getFilePathInWorkspace(".vscode/xcode/bundles"));
}

export async function handleValidationErrors<T>(
    commandContext: CommandContext,
    error: unknown,
    repeatOnChange: () => Promise<T>
) {
    if (error === ProjectFileMissedError) {
        if (!projectManager) {
            throw Error("ProjectManager is not valid");
        }

        if ((await selectProjectFile(commandContext, projectManager, false, true)) === false) {
            throw error; // cancelled
        }
        return await repeatOnChange();
    } else if (error === ProjectSchemeMissedError) {
        if ((await selectTarget(commandContext, true)) === false) {
            throw error; // cancelled
        }
        return await repeatOnChange();
    } else if (error === ProjectConfigurationMissedError) {
        if ((await selectConfiguration(commandContext, true)) === false) {
            throw error;
        }
        return await repeatOnChange();
    } else if (error === DebugDeviceIDMissedError) {
        if ((await selectDevice(commandContext, true)) === false) {
            throw error;
        }
        return await repeatOnChange();
    } else {
        throw error;
    }
}
