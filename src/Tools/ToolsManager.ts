import { exec } from "child_process";
import * as fs from "fs";
import * as vscode from "vscode";
import { getScriptPath, getSWBBuildServiceScriptPath } from "../env";
import { XCRunHelper } from "./XCRunHelper";
import { LogChannelInterface } from "../Logs/LogChannel";
import { CommandContext } from "../CommandManagement/CommandContext";
import { ExecutorMode } from "../Executor";

export class ToolsManager {
    private log: LogChannelInterface;

    constructor(log: LogChannelInterface) {
        this.log = log;
    }

    private async isToolInstalled(name: string, version = "--version"): Promise<boolean> {
        return new Promise(resolve => {
            const command = `${name} ${version}`;
            this.log.info(command);
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    this.log.info(stderr);
                    resolve(false);
                } else {
                    this.log.info(stdout);
                    resolve(true);
                }
            });
        });
    }

    private getInstalledGemLib(gemName: string): Promise<string[] | undefined> {
        // return new Promise(resolve => { resolve(false) });
        return new Promise(resolve => {
            const command = `gem list | grep ${gemName}`;
            this.log.info(command);
            exec(command, (error, stdout, stderr) => {
                this.log.info(`stderr: ${stderr}`);
                this.log.info(`stdout: ${stdout}`);
                if (error) {
                    resolve(undefined);
                } else {
                    // get version of gem lib
                    // xcodeproj (1.27.0, 1.26.0, 1.25.0)
                    const versions = [...stdout.matchAll(/(\d+).(\d+).(\d+)/gm)];
                    if (versions.length === 0) {
                        resolve(undefined);
                        return;
                    }
                    versions.sort((a, b) => {
                        for (let i = 1; i <= 3; i++) {
                            const numA = parseInt(a[i], 10);
                            const numB = parseInt(b[i], 10);
                            if (numA !== numB) {
                                return numB - numA;
                            }
                        }
                        return 0;
                    });
                    resolve([versions[0][1], versions[0][2], versions[0][3]]);
                }
            });
        });
    }

    private async isHomebrewInstalled() {
        return await this.isToolInstalled("brew");
    }

    private async isXcbeautifyInstalled() {
        return await this.isToolInstalled("xcbeautify");
    }

    private async isTuistInstalled() {
        return await this.isToolInstalled("tuist", "version");
    }

    private async isXcodeprojGemInstalled() {
        const version = await this.getInstalledGemLib("xcodeproj");
        if (version === undefined) {
            return false;
        }
        return XCRunHelper.isVersionGreaterOrEqual(
            [version[0], version[1], version[2]],
            [1, 27, 0]
        );
    }

    private async installHomebrew(context: CommandContext) {
        const installScript = `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`;
        await this.executeCommand(context, installScript);
    }

    async installPyInstaller(context: CommandContext) {
        return await this.installTool(context, "pyinstaller");
    }

    private async executeCommand(context: CommandContext, command: string): Promise<void> {
        await context.execShell(`${command}`, { command: command }, [], ExecutorMode.verbose);
        return;
    }

    async compileSWBBuildService(context: CommandContext, distPath: string) {
        await this.executeCommand(
            context,
            `pyinstaller --onefile '${getSWBBuildServiceScriptPath()}' --distpath '${distPath}'`
        );
        try {
            // remove quarantine attribute to allow execution without user interaction as it was generated from python script by user
            await this.executeCommand(
                context,
                `xattr -d -r com.apple.quarantine '${distPath}/SWBBuildService'`
            );
        } catch {
            // ignore error
        }
    }

    private async installTool(context: CommandContext, name: string, toolName = "brew") {
        const command = `${toolName} install ${name}`;
        await this.executeCommand(context, command);
    }

    private async isLLDBStubExeCompiled() {
        const lldb_exe_stub = getScriptPath("lldb_exe_stub");
        return fs.existsSync(lldb_exe_stub);
    }

    async isPyInstallerInstalled() {
        return await this.isToolInstalled("pyinstaller", "--version");
    }

    private async compileLLDStubExe(context: CommandContext) {
        const clang = await XCRunHelper.getClangCompilerPath();
        const sdk = await XCRunHelper.getSdkPath();
        const command = `${clang} -isysroot ${sdk} "${getScriptPath("lldb_exe_stub.c")}" -o "${getScriptPath("lldb_exe_stub")}"`;
        // this.terminal.show();
        await this.executeCommand(context, command);
    }

    private async installTools(context: CommandContext) {
        if (!(await this.isHomebrewInstalled())) {
            await this.installHomebrew(context);
        }

        if (!(await this.isXcbeautifyInstalled())) {
            await this.installTool(context, "xcbeautify");
        }

        if (!(await this.isTuistInstalled())) {
            await this.installTool(context, "tuist");
        }

        if (!(await this.isXcodeprojGemInstalled())) {
            await this.installTool(context, "xcodeproj", "gem");
        }

        if (!(await this.isLLDBStubExeCompiled())) {
            await this.compileLLDStubExe(context);
        }
    }

    public async updateThirdPartyTools(context: CommandContext) {
        try {
            await this.installTools(context);
            let firstError = null;
            try {
                await this.executeCommand(context, "brew update");
            } catch (error) {
                const message = `Failed to update Homebrew: ${error}`;
                this.log.error(message);
                firstError = message;
            }
            try {
                await this.executeCommand(context, "brew upgrade xcbeautify");
            } catch (error) {
                const message = `Failed to upgrade xcbeautify: ${error}`;
                this.log.error(message);
                firstError = firstError === null ? message : `${firstError};\n${message}`;
            }
            try {
                await this.executeCommand(context, "brew upgrade tuist");
            } catch (error) {
                const message = `Failed to upgrade tuist: ${error}`;
                this.log.error(message);
                firstError = firstError === null ? message : `${firstError};\n${message}`;
            }

            try {
                await this.executeCommand(context, "gem install xcodeproj");
            } catch (error) {
                const message = `Failed to install xcodeproj gem: ${error}`;
                this.log.error(message);
                firstError = firstError === null ? message : `${firstError};\n${message}`;
            }
            if (firstError !== null) {
                throw firstError;
            }
        } catch (error) {
            this.log.error(`Dependencies were not updated, error: ${error}`);
            vscode.window.showErrorMessage(
                `Dependencies were not updated. Try again or do it manually.\n Errors: ${error}`
            );
            throw error;
        }
    }

    public async resolveThirdPartyTools(
        context: CommandContext,
        askUserToInstallDeps: boolean = false
    ) {
        this.log.info("Resolving Third Party Dependencies");
        const hostPlatform = process.platform;
        if (hostPlatform !== "darwin") {
            throw Error(
                `Swift iOS Xcode IDE extension only works on macOS, current platform is ${hostPlatform}. This extension depends on Xcode which is available only on macOS`
            );
        }

        try {
            await XCRunHelper.checkIfXCodeInstalled();
        } catch (error) {
            throw Error(`Xcode is not installed. Please install it: ${error}`);
        }

        try {
            await this.compileLLDStubExe(context);
        } catch {
            if (!this.isLLDBStubExeCompiled()) {
                throw Error("Xcode is not installed. Please install it and restart VS Code");
            }
        }

        if (
            !(await this.isHomebrewInstalled()) ||
            !(await this.isXcbeautifyInstalled()) ||
            !(await this.isTuistInstalled()) ||
            !(await this.isXcodeprojGemInstalled()) ||
            !(await this.isLLDBStubExeCompiled())
        ) {
            let option: string | undefined = "Yes";
            if (!askUserToInstallDeps) {
                option = await vscode.window.showWarningMessage(
                    "Required tools are not installed. Without them extension would not work properly. Do you want to Install Them automatically?",
                    "Yes",
                    "No"
                );
            }
            if (option === "Yes") {
                try {
                    // install extensions
                    await this.installTools(context);
                    this.log.info("All dependencies are installed. You are ready to go");
                } catch (err) {
                    this.log.error(
                        `Dependencies were not installed: ${err}.\r\n This extensions would not be working as expected!`
                    );
                    throw Error(
                        `Dependencies were not installed: ${err}.\r\n This extensions would not be working as expected!`
                    );
                }
            } else {
                this.log.critical(
                    "Dependencies are not installed. This extensions would not be working as expected!"
                );
                throw Error(
                    "Dependencies are not installed. Extension would not be working properly"
                );
            }
        } else {
            this.log.info("All dependencies are installed. You are ready to go");
        }
    }
}
