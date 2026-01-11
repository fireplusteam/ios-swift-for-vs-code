import * as vscode from "vscode";
import { isActivated, ProjectEnv } from "../env";

export class StatusBar implements vscode.Disposable {
    private schemeStatusItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        5.04
    );

    private configurationStatusItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        5.03
    );

    private deviceStatusItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        5.021
    );

    private testPlanStatusItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        5.02
    );

    constructor() {
        this.schemeStatusItem.command = "vscode-ios.project.selectTarget";
        this.schemeStatusItem.tooltip = "Click to select the Xcode Project Scheme";

        this.configurationStatusItem.command = "vscode-ios.project.selectConfiguration";
        this.configurationStatusItem.tooltip =
            "Click to select the Xcode Project Build Configuration";

        this.deviceStatusItem.command = "vscode-ios.project.selectDevice";
        this.deviceStatusItem.tooltip = "Click to select the Xcode Project Debug Device";

        this.testPlanStatusItem.command = "vscode-ios.project.runTestPlan";
        this.testPlanStatusItem.tooltip = "Click to select Xcode Project Test Plan";
    }

    public dispose() {
        this.schemeStatusItem.dispose();
        this.configurationStatusItem.dispose();
        this.deviceStatusItem.dispose();
        this.testPlanStatusItem.dispose();
    }

    public async update(projectEnv: ProjectEnv) {
        if ((await isActivated()) === false) {
            this.schemeStatusItem.hide();
            this.configurationStatusItem.hide();
            this.deviceStatusItem.hide();
            this.testPlanStatusItem.hide();
            return;
        }
        try {
            this.schemeStatusItem.text = `$(target):${await projectEnv.projectScheme}`;
            this.schemeStatusItem.show();
        } catch {
            /// if the scheme is not yet set, display just busy icon
            this.schemeStatusItem.text = `$(target):$(busy)`;
            this.schemeStatusItem.show();
        }

        try {
            this.configurationStatusItem.text = `$(database):${await projectEnv.projectConfiguration}`;
            this.configurationStatusItem.show();
        } catch {
            this.configurationStatusItem.hide();
        }

        try {
            const device = await projectEnv.debugDeviceID;
            this.deviceStatusItem.text = `$(device-mobile):${device.name}`;
            if (device.OS !== undefined) {
                this.deviceStatusItem.text += `,${device.OS}`;
            }
            this.deviceStatusItem.show();
        } catch {
            this.deviceStatusItem.hide();
        }
    }
}
