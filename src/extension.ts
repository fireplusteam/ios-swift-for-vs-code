// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import {
    AppTargetExecutableMissedError,
    DebugDeviceIDMissedError,
    getFilePathInWorkspace,
    getLogPath,
    isActivated,
    isWorkspaceOpened,
    ProjectConfigurationMissedError,
    ProjectEnv,
    ProjectFileMissedError,
    ProjectSchemeMissedError,
} from "./env";
import {
    checkWorkspace,
    enableSWBBuildService,
    generateXcodeServer,
    generateXcodeWorkspaceForPackage,
    ksdiff,
    openFile,
    openXCode,
    runAppOnMultipleDevices,
    runTestPlan,
    selectConfiguration,
    selectDevice,
    selectProjectFile,
    selectScheme,
    updatePackageDependencies,
} from "./commands";
import { BuildTaskProvider } from "./BuildTaskProvider";
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
import { StatusBar } from "./StatusBar/StatusBar";
import { ProjectConfigurationDataProvider } from "./XcodeSideTreePanel/ProjectConfigurationDataProvider";
import { LogChannel } from "./Logs/LogChannel";
import { buildSelectedTarget, cleanDerivedData } from "./buildCommands";
import { RubyProjectFilesManager } from "./ProjectManager/RubyProjectFilesManager";

// SETTINGS WATCHER

function shouldInjectSWBBuildService() {
    const isEnabled = vscode.workspace.getConfiguration("vscode-ios").get("swb.build.service");
    if (!isEnabled) {
        return false;
    }
    return true;
}
function watchSWBBuildServiceSetting() {
    return vscode.workspace.onDidChangeConfiguration(async event => {
        if (event.affectsConfiguration("vscode-ios.swb.build.service")) {
            const shouldEnable = shouldInjectSWBBuildService();
            await enableSWBBuildService(shouldEnable);
        }
    });
}

// INITIALIZATION CODE

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
            vscode.window.showErrorMessage(
                `Project was not loaded due to error: ${JSON.stringify(error)}`
            );
            return false;
        }
    }

    emptyLog(".vscode/xcode/debugger.launching");
    async function checkWorkspaceWrapper() {
        try {
            await atomicCommand.userCommand(
                async context => {
                    // add BuildAll target root project if not exists (hide it with checkbox in settings)
                    await checkWorkspace(context, true);
                },
                "Initialize",
                undefined,
                false
            );
        } catch (error) {
            const option = await initializeWithError(error);
            if (option === "Open in Xcode") {
                vscode.commands.executeCommand("vscode-ios.env.open.xcode");
            }
            if (option === "Retry") {
                await checkWorkspaceWrapper();
            }
        }
    }
    await checkWorkspaceWrapper();

    lsp.start();
    fs.mkdir(getLogPath(), () => {});
    await enableSWBBuildService(shouldInjectSWBBuildService());
    await projectManager.loadProjectFiles();
    await projectManager.cleanAutocompleteSchemes();
    autocompleteWatcher.triggerIncrementalBuild();
    return true;
}

const logChannel = new LogChannel("VSCode-iOS");
const problemDiagnosticResolver = new ProblemDiagnosticResolver(logChannel);
const workspaceContext = new WorkspaceContextImp(problemDiagnosticResolver);
const sourceLsp = new SwiftLSPClient(workspaceContext, logChannel);
const projectManager = new ProjectManager(logChannel, new RubyProjectFilesManager(logChannel));
const atomicCommand = new AtomicCommand(sourceLsp, projectManager, logChannel);

let debugConfiguration: DebugConfigurationProvider;
let autocompleteWatcher: AutocompleteWatcher | undefined;
let testProvider: TestProvider | undefined;

const runtimeWarningsDataProvider = new RuntimeWarningsDataProvider();
const runtimeWarningLogWatcher = new RuntimeWarningsLogWatcher(
    runtimeWarningsDataProvider,
    logChannel
);

const statusBar = new StatusBar();

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    context.subscriptions.push(logChannel);
    logChannel.mode = context.extensionMode;
    logChannel.appendLine("Activated");

    const tools = new ToolsManager(logChannel);
    await tools.resolveThirdPartyTools();

    projectManager.onUpdateDeps = async () => {
        await tools.updateThirdPartyTools();
    };
    autocompleteWatcher = new AutocompleteWatcher(
        atomicCommand,
        problemDiagnosticResolver,
        logChannel
    );

    // initialise code
    context.subscriptions.push(sourceLsp);

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

    context.subscriptions.push(watchSWBBuildServiceSetting());

    statusBar.update(new ProjectEnv({ settings: Promise.resolve({}) }));
    context.subscriptions.push(
        ProjectEnv.onDidChangeProjectEnv(projectEnv => statusBar.update(projectEnv))
    );

    context.subscriptions.push(statusBar);

    context.subscriptions.push(getReadOnlyDocumentProvider());

    vscode.commands.executeCommand("setContext", "vscode-ios.activated", true);

    vscode.window.registerTreeDataProvider("RuntimeWarningsProvider", runtimeWarningsDataProvider);

    const projectConfigurationDataProvider = new ProjectConfigurationDataProvider();
    projectConfigurationDataProvider.refresh(new ProjectEnv({ settings: Promise.resolve({}) }));
    ProjectEnv.onDidChangeProjectEnv(projectEnv =>
        projectConfigurationDataProvider.refresh(projectEnv)
    );
    vscode.window.registerTreeDataProvider(
        "ProjectConfigurationDataProvider",
        projectConfigurationDataProvider
    );

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
        vscode.debug.registerDebugAdapterTrackerFactory("lldb-dap", debugAdapterFactory)
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
        logChannel,
        async (isDebuggable, testRun, context, testInput, onFinishTestSubsession) => {
            return await debugConfiguration.startIOSTestsDebugger(
                isDebuggable,
                testRun,
                context,
                testInput,
                onFinishTestSubsession
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
            "xcode",
            new BuildTaskProvider("xcode", problemDiagnosticResolver, atomicCommand)
        )
    );
    context.subscriptions.push(
        vscode.tasks.registerTaskProvider(
            "xcode-watch",
            new BuildTaskProvider("xcode-watch", problemDiagnosticResolver, atomicCommand)
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
                    openXCode(contextSelection.fsPath, logChannel);
                } else {
                    openXCode(
                        vscode.window.activeTextEditor?.document.uri.fsPath || "",
                        logChannel
                    );
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.project.selectScheme", async () => {
            await atomicCommand.userCommandWithoutThrowingException(async context => {
                await selectScheme(context);
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
        vscode.commands.registerCommand("vscode-ios.project.runTestPlan", async () => {
            await atomicCommand.userCommandWithoutThrowingException(async context => {
                if (!testProvider) {
                    throw Error("Test Provider is not initialized");
                }
                await runTestPlan(context, testProvider);
            }, "Run Test Plan");
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
            await atomicCommand.userCommandWithoutThrowingException(async context => {
                await cleanDerivedData(context);
            }, "Clean Derived Data");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.build.selectedTarget", async () => {
            await atomicCommand.userCommandWithoutThrowingException(async context => {
                await buildSelectedTarget(context, problemDiagnosticResolver);
            }, "Build Selected Target");
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
        vscode.commands.registerCommand(
            "vscode-ios.project.package.generate.workspace",
            async () => {
                atomicCommand.userCommand(async context => {
                    let swiftPackageFile = await context.projectEnv.swiftPackageFile;
                    if (swiftPackageFile === undefined || swiftPackageFile === "") {
                        vscode.window.showErrorMessage(
                            "Current project is not a Swift Package Manager project. Use 'Xcode: Select Project/Workspace/Package' command to select a Swift Package."
                        );
                        return;
                    }
                    swiftPackageFile = getFilePathInWorkspace(swiftPackageFile);
                    await generateXcodeWorkspaceForPackage(context, swiftPackageFile);
                    await context.projectEnv.setSwiftPackageProjectFileGenerated();
                }, "Generate Xcode Workspace for Swift Package");
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.run.project.update.deps", async () => {
            atomicCommand.userCommand(async context => {
                await updatePackageDependencies(context);
            }, "Update Package Dependencies");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-ios.switch.header.source", async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            const document = editor.document;
            const filePath = document.uri.fsPath;
            const isHeader = () => {
                return filePath.endsWith(".h") || filePath.endsWith(".hpp");
            };
            const fileEnds = isHeader() ? [".cpp", ".c", ".m", ".mm", ".cpp"] : [".h", ".hpp"];
            for (const file of fileEnds) {
                const sourceFilePath = filePath.split(".").slice(0, -1).join(".") + file;
                if (fs.existsSync(sourceFilePath)) {
                    openFile(sourceFilePath, undefined);
                    return;
                }
            }
        })
    );
}

// This method is called when your extension is deactivated
export async function deactivate() {
    autocompleteWatcher?.terminate();
    atomicCommand.cancel();
    runtimeWarningLogWatcher.disposeWatcher();
    projectManager?.cleanAutocompleteSchemes();
    deleteFile(getFilePathInWorkspace(".vscode/xcode/bundles"));
}

export async function handleValidationErrors<T>(
    commandContext: CommandContext,
    error: unknown,
    repeatOnChange: () => Promise<T>
) {
    try {
        commandContext.log.error(`HandleValidationErrors: ${JSON.stringify(error)}`);
    } catch {
        /* empty */
    }
    if (typeof error === "object" && error !== null && "code" in error) {
        switch (error.code) {
            case 65: // scheme is not valid
                if ("stderr" in error) {
                    const stderr = error.stderr as string;
                    const searchPattern = `does not contain a scheme named "${await commandContext.projectEnv.projectScheme}"`;

                    if (stderr.indexOf(searchPattern) !== -1) {
                        await commandContext.projectEnv.setProjectScheme("");
                        return await repeatOnChange();
                    }
                }
                break;

            case 70: // device destination is not valid
                await commandContext.projectEnv.setDebugDeviceID(null);
                return await repeatOnChange();
        }
    }
    if (error === ProjectFileMissedError) {
        if (!projectManager) {
            throw Error("ProjectManager is not valid");
        }

        if ((await selectProjectFile(commandContext, projectManager, false, true)) === false) {
            throw error; // cancelled
        }
        return await repeatOnChange();
    } else if (error === ProjectSchemeMissedError) {
        if ((await selectScheme(commandContext, true)) === false) {
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
    } else if (error === AppTargetExecutableMissedError) {
        vscode.window.showErrorMessage(
            `The selected app target executable is missing. Please ensure that the scheme is built successfully or it's executable.`
        );
        throw error;
    } else {
        throw error;
    }
}
