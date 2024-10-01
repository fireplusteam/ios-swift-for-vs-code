import * as vscode from 'vscode';
import { CommandContext } from "../CommandManagement/CommandContext";
import { getScriptPath, Platform, ProjectEnv } from "../env";
import { sleep } from "../extension";
import { promiseWithTimeout, TimeoutError } from "../utils";
import { DebugAdapterTracker } from '../Debug/DebugAdapterTracker';
import { ExecutorMode } from '../execShell';
import { error } from 'console';


export class RunManager {
    private sessionID: string;
    private isDebuggable: boolean;
    private env: ProjectEnv

    private terminalName = "Run App";

    private get debuggerArg(): string {
        return this.isDebuggable ? "LLDB_DEBUG" : "RUNNING";
    }

    constructor(sessionID: string, isDebuggable: boolean, env: ProjectEnv) {
        this.sessionID = sessionID;
        this.isDebuggable = isDebuggable;
        this.env = env;
    }

    async runOnDebugDevice(context: CommandContext) {
        if (await this.env.platform == Platform.macOS) {
            return await this.runOnMac(context);
        }

        return await this.runOnSimulator(context, await this.env.debugDeviceID, true);
    }

    async runOnMultipleDevices(context: CommandContext) {
        if (await this.env.platform == Platform.macOS) {
            throw Error("MacOS Platform doesn't support running on Multiple Devices!");
        }
        if (this.isDebuggable) {
            throw Error("Debug mode is not supported in run on multiple devices");
        }

        const devices = (await this.env.multipleDeviceID).split(" |");
        if (devices == undefined || devices.length == 0)
            throw Error("Can not run on empty device");
        await DebugAdapterTracker.updateStatus(this.sessionID, "launching");
        try {
            for (const device of devices) {
                await this.runOnSimulator(context, device.substring("id=".length), false);
            }
        } catch (error) {
            console.log(error);
            throw error;
        }
    }

    private async runOnSimulator(context: CommandContext, deviceId: string, waitDebugger: boolean) {
        await this.terminateCurrentIOSApp(context, this.sessionID, deviceId);

        try {
            await context.execShellWithOptions({
                terminalName: this.terminalName,
                scriptOrCommand: { command: "xcrun" },
                args: ["simctl", "boot", deviceId]
            });
        } catch {

        }

        await context.execShellWithOptions({
            terminalName: this.terminalName,
            scriptOrCommand: { command: "open /Applications/Xcode.app/Contents/Developer/Applications/Simulator.app/" }
        });

        while (true) {
            const result = await context.execShellWithOptions({
                scriptOrCommand: { command: `xcrun` },
                args: ["simctl", "list", "devices", "-j"],
            });
            const json = JSON.parse(result.stdout);
            let booted = false;
            for (const key in json.devices) {
                const value = json.devices[key];
                for (const device of value)
                    if (device.udid === deviceId) {
                        if (device.state == "Booted") {
                            booted = true;
                            break;
                        }
                    }
                if (booted) break;
            }
            if (booted) break;
            sleep(1)
        }
        await context.execShellWithOptions({
            terminalName: this.terminalName,
            scriptOrCommand: { command: "xcrun" },
            args: ["simctl", "install", deviceId, await this.env.appExecutablePath]
        });

        context.execShellParallel({
            scriptOrCommand: { file: "launch.py" },
            args: [deviceId, await this.env.bundleAppName, this.debuggerArg, this.sessionID, waitDebugger ? "true" : "false"]
        }).catch(reason => {
            console.warn(`Session ID: ${this.sessionID}, terminated with error: ${error}}`);
        });
    }

    private async runOnMac(context: CommandContext) {
        context.execShellParallel({
            scriptOrCommand: { file: "launch.py" },
            args: ["MAC_OS", await this.env.bundleAppName, this.debuggerArg, this.sessionID]
        });
    }

    private async terminateCurrentIOSApp(commandContext: CommandContext, sessionID: string, deviceId: string) {
        try {
            // wait for 6 seconds to terminate the app, and reboot simulator if it's not launched
            await promiseWithTimeout(6000, async () => {
                await commandContext.execShell(
                    "Terminate iOS App",
                    { command: "xcrun" },
                    ["simctl", "terminate", deviceId, await this.env.bundleAppName]
                );
            });
        } catch (err) {
            if (err == TimeoutError) {
                // we should cancel it in a new executor as it can not be executed 
                await commandContext.execShellParallel({
                    scriptOrCommand: { command: "xcrun" },
                    args: ["simctl", "shutdown", deviceId],
                });
                vscode.window.showInformationMessage("Simulator freezed, rebooted it!");
            }
        }
    }
}