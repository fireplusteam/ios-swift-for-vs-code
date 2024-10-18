import * as vscode from "vscode";
import { CommandContext } from "../CommandManagement/CommandContext";
import { DeviceID, getFilePathInWorkspace } from "../env";
import { sleep } from "../extension";
import { deleteFile, promiseWithTimeout, TimeoutError } from "../utils";
import { DebugAdapterTracker } from "../Debug/DebugAdapterTracker";
import { ExecutorMode, ExecutorTaskError } from "../Executor";
import { BuildManager } from "./BuildManager";

export class RunManager {
    private sessionID: string;
    private isDebuggable: boolean;

    constructor(sessionID: string, isDebuggable: boolean) {
        this.sessionID = sessionID;
        this.isDebuggable = isDebuggable;
    }

    async runOnDebugDevice(context: CommandContext) {
        if ((await context.projectSettingsProvider.projectEnv.debugDeviceID).platform === "macOS") {
            return await this.runOnMac(context);
        }

        return await this.runOnSimulator(
            context,
            await context.projectSettingsProvider.projectEnv.debugDeviceID,
            true
        );
    }

    async runOnMultipleDevices(context: CommandContext) {
        if ((await context.projectSettingsProvider.projectEnv.debugDeviceID).platform === "macOS") {
            throw Error("MacOS Platform doesn't support running on Multiple Devices!");
        }
        if (this.isDebuggable) {
            throw Error("Debug mode is not supported in run on multiple devices");
        }

        const devices = await context.projectSettingsProvider.projectEnv.multipleDeviceID;
        if (devices === undefined || devices.length === 0) {
            throw Error("Can not run on empty device");
        }
        await DebugAdapterTracker.updateStatus(this.sessionID, "launching");
        const debugDeviceID = await context.projectSettingsProvider.projectEnv.debugDeviceID;
        for (const device of devices) {
            if (debugDeviceID.platform === device.platform) {
                // we can run only on the platform that was built to
                await this.runOnSimulator(context, device, false);
            }
        }
    }

    async runTests(context: CommandContext, tests: string[]) {
        deleteFile(getFilePathInWorkspace(BuildManager.BundlePath));
        deleteFile(getFilePathInWorkspace(`${BuildManager.BundlePath}.xcresult`));
        const logFilePath = ".logs/tests.log";

        await this.waitDebugger(context);

        await context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            pipeToDebugConsole: true,
            args: [
                "test-without-building",
                ...tests.map(test => {
                    return `-only-testing:${test}`;
                }),
                ...(await BuildManager.args(context.projectSettingsProvider.projectEnv)),
                "-parallel-testing-enabled",
                "NO",
                // "-xctestrun", // use https://medium.com/xcblog/speed-up-ios-ci-using-test-without-building-xctestrun-and-fastlane-a982b0060676
                // "./vscode/testrun_example.xctestrun",
            ],
            mode: ExecutorMode.resultOk | ExecutorMode.stderr | ExecutorMode.commandName,
            pipe: {
                scriptOrCommand: { command: "tee" },
                args: [logFilePath],
                mode: ExecutorMode.none,
                pipe: {
                    scriptOrCommand: {
                        command: "xcbeautify",
                        labelInTerminal: "Run Tests",
                    },
                    mode: ExecutorMode.stdout,
                },
            },
        });
    }

    private async runOnSimulator(
        context: CommandContext,
        deviceId: DeviceID,
        waitDebugger: boolean
    ) {
        await this.terminateCurrentIOSApp(context, this.sessionID, deviceId.id);

        try {
            await context.execShellWithOptions({
                scriptOrCommand: { command: "xcrun" },
                args: ["simctl", "boot", deviceId.id],
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
                    if (device.udid === deviceId.id) {
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
            args: [
                "simctl",
                "install",
                deviceId.id,
                await context.projectSettingsProvider.projectEnv.appExecutablePath(deviceId),
            ],
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
                    deviceId.id,
                    await context.projectSettingsProvider.projectEnv.bundleAppName,
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
                        await this.shutdownSimulator(context, deviceId.id);
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
        const exePath = await context.projectSettingsProvider.projectEnv.appExecutablePath(
            await context.projectSettingsProvider.projectEnv.debugDeviceID
        );
        const productName = await context.projectSettingsProvider.projectEnv.productName;

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
        const bundleAppName = await commandContext.projectSettingsProvider.projectEnv.bundleAppName;
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
