import * as vscode from "vscode";
import {
    CommandContext,
    UserTerminalCloseError,
    UserTerminatedError,
} from "../CommandManagement/CommandContext";
import { BundleAppNameMissedError, DeviceID, getLogRelativePath } from "../env";
import { sleep } from "../utils";
import { promiseWithTimeout, TimeoutError } from "../utils";
import { DebugAdapterTracker } from "../Debug/DebugAdapterTracker";
import { ExecutorMode, ExecutorTaskError } from "../Executor";
import { BuildManager } from "./BuildManager";
import { XCRunHelper } from "../Tools/XCRunHelper";

export class RunManager {
    private sessionID: string;
    private isDebuggable: boolean;

    constructor(sessionID: string, isDebuggable: boolean) {
        this.sessionID = sessionID;
        this.isDebuggable = isDebuggable;
    }

    async runOnDebugDevice(context: CommandContext) {
        if ((await context.projectEnv.debugDeviceID).platform === "macOS") {
            return await this.runOnMac(context);
        }

        return await this.runOnSimulator(context, await context.projectEnv.debugDeviceID, true);
    }

    async runOnMultipleDevices(context: CommandContext) {
        if ((await context.projectEnv.debugDeviceID).platform === "macOS") {
            throw Error("MacOS Platform doesn't support running on Multiple Devices!");
        }
        if (this.isDebuggable) {
            throw Error("Debug mode is not supported in run on multiple devices");
        }

        const devices = await context.projectEnv.multipleDeviceID;
        if (devices === undefined || devices.length === 0) {
            throw Error("Can not run on empty device");
        }
        await DebugAdapterTracker.updateStatus(this.sessionID, "launching");
        const debugDeviceID = await context.projectEnv.debugDeviceID;
        for (const device of devices) {
            if (debugDeviceID.platform === device.platform && debugDeviceID.arch === device.arch) {
                // we can run only on the platform that was built to
                await this.runOnSimulator(context, device, false);
            }
        }
    }

    async runTests(
        context: CommandContext,
        tests: string[],
        xctestrun: string,
        isCoverage: boolean
    ) {
        context.bundle.generateNext();
        const logFilePath = getLogRelativePath("tests.log");

        let isSimulatorRequired = false;
        const deviceId = await context.projectEnv.debugDeviceID;
        if (deviceId.platform !== "macOS") {
            isSimulatorRequired = true;
            await this.prepareSimulator(context, deviceId);
        }

        await this.waitDebugger(context);

        try {
            await context.execShellWithOptions({
                scriptOrCommand: { command: "xcodebuild" },
                pipeToDebugConsole: true,
                args: [
                    "test-without-building",
                    ...tests.map(test => {
                        return `-only-testing:${test}`;
                    }),
                    "-xctestrun",
                    xctestrun,
                    ...(await BuildManager.commonArgs(context.projectEnv, context.bundle)),
                    "-parallel-testing-enabled",
                    "NO",
                    ...(isSimulatorRequired ? ["-destination", `id=${deviceId.id}`] : []),
                    "-enableCodeCoverage",
                    isCoverage ? "YES" : "NO",
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
        } finally {
            DebugAdapterTracker.updateStatus(this.sessionID, "stopped");
        }
    }

    private async runOnSimulator(
        context: CommandContext,
        deviceId: DeviceID,
        waitDebugger: boolean
    ) {
        await this.prepareSimulator(context, deviceId);
        try {
            await context.execShellWithOptions({
                scriptOrCommand: { command: "xcrun" },
                args: [
                    "simctl",
                    "install",
                    deviceId.id,
                    await context.projectEnv.appExecutablePath(deviceId),
                ],
                mode: ExecutorMode.verbose,
            });
        } catch (error) {
            DebugAdapterTracker.updateStatus(this.sessionID, "stopped");
            if (error !== UserTerminalCloseError && error !== UserTerminatedError) {
                vscode.window.showErrorMessage(
                    "Can not find app executable to install on simulator. Please check build log for details."
                );
            }

            throw error;
        }

        if (context.terminal) {
            context.terminal.terminalName = "Waiting Debugger";
        }

        if (waitDebugger) {
            await this.waitDebugger(context);
        }

        if (context.terminal) {
            context.terminal.terminalName = "App Running";
        }

        const bundleAppName = await context.projectEnv.bundleAppName;

        let isHandled = false;
        context
            .execShellParallel({
                scriptOrCommand: { command: "xcrun" },
                args: ["simctl", "launch", "--console-pty", deviceId.id, bundleAppName],
                pipeToDebugConsole: true,
                kill: { signal: "SIGKILL", allSubProcesses: true },
            })
            .catch(async error => {
                context.log.error(`Session ID: ${this.sessionID}, terminated with error: ${error}`);
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
            })
            .finally(() => {
                if (!isHandled) {
                    DebugAdapterTracker.updateStatus(this.sessionID, "stopped");
                }
            });
    }

    private async prepareSimulator(context: CommandContext, deviceId: DeviceID) {
        await this.terminateCurrentIOSApp(context, this.sessionID, deviceId.id);

        try {
            await context.execShellWithOptions({
                scriptOrCommand: { command: "xcrun" },
                args: ["simctl", "boot", deviceId.id],
                kill: { signal: "SIGKILL", allSubProcesses: true },
            });
        } catch {
            /* empty */
        }

        try {
            await context.execShellWithOptions({
                scriptOrCommand: {
                    command: `open '${await XCRunHelper.getXcodePath()}/Applications/Simulator.app/'`,
                    labelInTerminal: "Opening Simulator",
                },
                mode: ExecutorMode.onlyCommandNameAndResult,
            });
        } catch (error) {
            context.log.error(`Error on opening simulator: ${error}`);
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
    }

    private async runOnMac(context: CommandContext) {
        // const exePath = await context.projectEnv.appExecutablePath(
        //     await context.projectEnv.debugDeviceID
        // );
        // const productName = await context.projectEnv.productName;

        if (context.terminal) {
            context.terminal.terminalName = "Waiting Debugger";
        }

        await this.waitDebugger(context);

        if (context.terminal) {
            context.terminal.terminalName = "App Running";
        }

        // for macOS we can directly run the executable via lldb launch request in DebugConfigurationsProvider
        // const productPath = exePath.endsWith(".app")
        //     ? `${exePath}/Contents/MacOS/${productName}`
        //     : exePath;

        // context
        //     .execShellParallel({
        //         scriptOrCommand: { command: productPath },
        //         args: [],
        //         pipeToDebugConsole: true,
        //     })
        //     .catch(error => {
        //         context.log.error(`Error in launched app: ${error}`);
        //         DebugAdapterTracker.updateStatus(this.sessionID, "stopped");
        //     });
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
        try {
            const bundleAppName = await commandContext.projectEnv.bundleAppName;
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
            } else if (err === BundleAppNameMissedError) {
                // skip, nothing to terminate as running tests
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
