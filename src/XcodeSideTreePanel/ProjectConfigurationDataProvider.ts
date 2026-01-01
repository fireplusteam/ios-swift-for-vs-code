import * as vscode from "vscode";
import { ProjectEnv } from "../env";

export class ProjectConfigurationNode extends vscode.TreeItem {
    constructor(message: string, command: string, icon: string, tooltip: string, id: string) {
        const label: vscode.TreeItemLabel = {
            label: message,
            highlights: [[0, message.indexOf(":") + 1]],
        };
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = tooltip;
        this.id = id;
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this.command = {
            title: "Open location",
            command: command,
        };
        this.iconPath = new vscode.ThemeIcon(icon);
    }
}

export class ProjectConfigurationDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
    readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

    private config: ProjectConfigurationNode[] = [];

    public async refresh(projectEnv: ProjectEnv) {
        this.config = [];

        try {
            const project = `Xcode Project: ${await projectEnv.projectFile}`;
            this.config.push(
                new ProjectConfigurationNode(
                    project,
                    "vscode-ios.project.select",
                    "workspace-trusted",
                    "Click to select Xcode Project File",
                    "Project:ProjectFile"
                )
            );
        } catch {
            /// if the scheme is not yet set, display just busy icon
            const project = `Xcode Project: (Tap To Select One)`;
            this.config.push(
                new ProjectConfigurationNode(
                    project,
                    "vscode-ios.project.select",
                    "workspace-trusted",
                    "Click to select Xcode Project File",
                    "Project:ProjectFile "
                )
            );
        }

        try {
            if ((await projectEnv.workspaceType()) === "package") {
                const swiftPackageFile = await projectEnv.swiftPackageFile;
                const packageNode = `Refresh Workspace for Swift Package: ${swiftPackageFile}`;
                this.config.push(
                    new ProjectConfigurationNode(
                        packageNode,
                        "vscode-ios.project.package.generate.workspace",
                        "package",
                        "Click to refresh project file for Swift Package",
                        "Project:SwiftPackageFile"
                    )
                );
            }
        } catch {
            // not swift package file, do nothing
        }

        try {
            const scheme = `Scheme: ${await projectEnv.projectScheme}`;
            this.config.push(
                new ProjectConfigurationNode(
                    scheme,
                    "vscode-ios.project.selectTarget",
                    "target",
                    "Click to select Xcode Project Scheme",
                    "Project:Scheme"
                )
            );
        } catch {
            /// if the scheme is not yet set, display just busy icon
            const scheme = `Scheme: (Tap To Select One)`;
            this.config.push(
                new ProjectConfigurationNode(
                    scheme,
                    "vscode-ios.project.selectTarget",
                    "target",
                    "Click to select Xcode Project Scheme",
                    "Project:Scheme"
                )
            );
        }

        try {
            const configuration = `Configuration: ${await projectEnv.projectConfiguration}`;
            this.config.push(
                new ProjectConfigurationNode(
                    configuration,
                    "vscode-ios.project.selectConfiguration",
                    "database",
                    "Click to select Xcode Project Configuration",
                    "Project:Configuration"
                )
            );
        } catch {
            const configuration = `Configuration: (Tap To Select One)`;
            this.config.push(
                new ProjectConfigurationNode(
                    configuration,
                    "vscode-ios.project.selectConfiguration",
                    "database",
                    "Click to select Xcode Project Configuration",
                    "Project:Configuration"
                )
            );
        }

        try {
            const device = await projectEnv.debugDeviceID;
            const configuration = `Debug Device: ${device.name}, OS: ${device.OS}`;
            this.config.push(
                new ProjectConfigurationNode(
                    configuration,
                    "vscode-ios.project.selectDevice",
                    "device-mobile",
                    "Click to select Xcode Project Debug Device",
                    "Project:DebugDevice"
                )
            );
        } catch {
            const configuration = `Debug Device: (Tap To Select One)`;
            this.config.push(
                new ProjectConfigurationNode(
                    configuration,
                    "vscode-ios.project.selectDevice",
                    "device-mobile",
                    "Click to select Xcode Project Debug Device",
                    "Project:DebugDevice"
                )
            );
        }

        try {
            const configuration = `Test Plan: ${await projectEnv.projectTestPlan}`;
            this.config.push(
                new ProjectConfigurationNode(
                    configuration,
                    "vscode-ios.project.selectTestPlan",
                    "shield",
                    "Click to select Xcode Project Test Plan",
                    "Project:TestPlan"
                )
            );
        } catch {
            const configuration = `Test Plan: <Autogenerated> (Tap to select different one)`;
            this.config.push(
                new ProjectConfigurationNode(
                    configuration,
                    "vscode-ios.project.selectTestPlan",
                    "shield",
                    "Click to select Xcode Project Test Plan",
                    "Project:TestPlan"
                )
            );
        }

        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            // return root elements
            return Promise.resolve(this.config);
        }
    }
}
