import * as vscode from "vscode";
import { CommandContext } from "../CommandManagement/CommandContext";
import { Platform, ProjectEnv } from "../env";
import { sleep } from "../extension";
import { promiseWithTimeout, TimeoutError } from "../utils";
import { DebugAdapterTracker } from "../Debug/DebugAdapterTracker";
import { ExecutorMode, ExecutorTaskError } from "../Executor";

export class RunManager {
    private sessionID: string;
    private isDebuggable: boolean;
    private env: ProjectEnv;

    constructor(sessionID: string, isDebuggable: boolean, env: ProjectEnv) {
        this.sessionID = sessionID;
        this.isDebuggable = isDebuggable;
        this.env = env;
    }

    async runOnDebugDevice(context: CommandContext) {
        if ((await this.env.platform) === Platform.macOS) {
            return await this.runOnMac(context);
        }

        return await this.runOnSimulator(context, await this.env.debugDeviceID, true);
    }

    async runOnMultipleDevices(context: CommandContext) {
        if ((await this.env.platform) === Platform.macOS) {
            throw Error("MacOS Platform doesn't support running on Multiple Devices!");
        }
        if (this.isDebuggable) {
            throw Error("Debug mode is not supported in run on multiple devices");
        }

        const devices = (await this.env.multipleDeviceID)
            .split(" |")
            .map(deviceId => deviceId.substring("id=".length));
        if (devices === undefined || devices.length === 0) {
            throw Error("Can not run on empty device");
        }
        await DebugAdapterTracker.updateStatus(this.sessionID, "launching");
        for (const device of devices) {
            await this.runOnSimulator(context, device, false);
        }
    }

    private async runOnSimulator(context: CommandContext, deviceId: string, waitDebugger: boolean) {
        await this.terminateCurrentIOSApp(context, this.sessionID, deviceId);

        try {
            await context.execShellWithOptions({
                scriptOrCommand: { command: "xcrun" },
                args: ["simctl", "boot", deviceId],
            });
        } catch {
            /* empty */
        }

        try {
            await context.execShellWithOptions({
                scriptOrCommand: {
                    command:
                        "open /Applications/Xcode.app/Contents/Developer/Applications/Simulator.app/",
                    labelInTerminal: "Opening Simulator",
                },
                mode: ExecutorMode.onlyCommandNameAndResult,
            });
        } catch (error) {
            console.log("Simulator loaded");
        }

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const result = await context.execShellWithOptions({
                scriptOrCommand: { command: `xcrun`, labelInTerminal: "Check if simulator opened" },
                args: ["simctl", "list", "devices", "-j"],
                mode: ExecutorMode.onlyCommandNameAndResult,
            });
            const json = JSON.parse(result.stdout);
            let booted = false;
            for (const key in json.devices) {
                const value = json.devices[key];
                for (const device of value) {
                    if (device.udid === deviceId) {
                        if (device.state === "Booted") {
                            booted = true;
                            break;
                        }
                    }
                }
                if (booted) {
                    break;
                }
            }
            if (booted) {
                break;
            }
            sleep(1);
        }
        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcrun" },
            args: ["simctl", "install", deviceId, await this.env.appExecutablePath],
        });

        if (context.terminal) {
            context.terminal.terminalName = "Waiting Debugger";
        }

        if (waitDebugger) {
            await this.waitDebugger(context);
        }

        if (context.terminal) {
            context.terminal.terminalName = "App Running";
        }

        context
            .execShellParallel({
                scriptOrCommand: { command: "xcrun" },
                args: [
                    "simctl",
                    "launch",
                    "--console-pty",
                    deviceId,
                    await this.env.bundleAppName,
                    "--wait-for-debugger",
                ],
                pipeToDebugConsole: true,
            })
            .catch(async error => {
                console.warn(`Session ID: ${this.sessionID}, terminated with error: ${error}}`);
                let isHandled = false;
                if (error instanceof ExecutorTaskError) {
                    if (error.code === 3) {
                        //simulator is not responding
                        await this.shutdownSimulator(context, deviceId);
                        if (context.cancellationToken.isCancellationRequested === false) {
                            isHandled = true;
                            this.runOnSimulator(context, deviceId, waitDebugger);
                        }
                    }
                }
                if (!isHandled) {
                    DebugAdapterTracker.updateStatus(this.sessionID, "stopped");
                }
            });
    }

    private async runOnMac(context: CommandContext) {
        const exePath = await this.env.appExecutablePath;
        const productName = await this.env.productName;

        if (context.terminal) {
            context.terminal.terminalName = "Waiting Debugger";
        }

        await this.waitDebugger(context);

        if (context.terminal) {
            context.terminal.terminalName = "App Running";
        }

        context
            .execShellParallel({
                scriptOrCommand: { command: `${exePath}/Contents/MacOS/${productName}` },
                args: ["--wait-for-debugger"],
                pipeToDebugConsole: true,
            })
            .catch(error => {
                console.log(`Error in launched app: ${error}`);
                DebugAdapterTracker.updateStatus(this.sessionID, "stopped");
            });
    }

    private async waitDebugger(context: CommandContext) {
        await context.execShellWithOptions({
            scriptOrCommand: { file: "wait_debugger.py" },
            args: [this.sessionID],
        });
    }

    private async terminateCurrentIOSApp(
        commandContext: CommandContext,
        sessionID: string,
        deviceId: string
    ) {
        const bundleAppName = await this.env.bundleAppName;
        try {
            // wait for 6 seconds to terminate the app, and reboot simulator if it's not launched
            await promiseWithTimeout(10000, async () => {
                await commandContext.execShell(
                    "Terminate Previous Running App",
                    { command: "xcrun" },
                    ["simctl", "terminate", deviceId, bundleAppName]
                );
            });
        } catch (err) {
            if (err === TimeoutError) {
                // we should cancel it in a new executor as it can not be executed
                await this.shutdownSimulator(commandContext, deviceId);
            }
        }
    }

    private async shutdownSimulator(commandContext: CommandContext, deviceId: string) {
        await commandContext.execShellParallel({
            scriptOrCommand: { command: "xcrun" },
            args: ["simctl", "shutdown", deviceId],
        });
        vscode.window.showInformationMessage("Simulator freezed, rebooted it!");
    }
}
