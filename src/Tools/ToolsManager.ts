import { exec } from "child_process";
import * as vscode from "vscode";

export class ToolsManager {
    private log: vscode.OutputChannel;

    constructor(log: vscode.OutputChannel) {
        this.log = log;
    }

    private async isToolInstalled(name: string, version = "--version"): Promise<boolean> {
        return new Promise((resolve,) => {
            exec(`${name} ${version}`, (error, stdout, stderr) => {
                if (error)
                    resolve(false);
                else
                    resolve(true);
            });
        });
    }

    private isGemInstalled(gemName: string): Promise<boolean> {
        return new Promise((resolve,) => {
            exec(`gem list ^${gemName}$ -i`, (error, stdout, stderr) => {
                if (error) {
                    resolve(false);
                } else {
                    // stdout returns a boolean as a string, either 'true' or 'false'
                    const isInstalled = stdout.trim() === 'true';
                    resolve(isInstalled);
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

    private async isRubyInstalled() {
        return await this.isToolInstalled("ruby", "-v");
    }

    private async installHomebrew(): Promise<boolean> {
        const password = await vscode.window.showInputBox({ ignoreFocusOut: false, prompt: `In order to install Homebrew, please enter sudo password`, password: true });
        if (password === undefined) {
            throw "Password is not provided"
        }
        this.log.appendLine('Attempting to install Homebrew...');
        const installScript = `echo '${password}' | sudo /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`;
        return await (new Promise((resolver) => {
            exec(installScript, { shell: "true" }, (error, stdout, stderr) => {
                if (error) {
                    this.log.appendLine(`An error occurred: ${stderr}`);
                    resolver(false);
                    return;
                }
                this.log.appendLine(`Homebrew installation completed: ${stdout}`);
                resolver(true);
            })
        }));
    };

    private async installTool(name: string, toolName = "brew") {
        return new Promise((resolver,) => {
            const command = `${toolName} install ${name}`;
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    resolver(false);
                } else {
                    resolver(true);
                }
            })
        });
    }

    private async installTools() {
        const toolsCount = 4;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Installing Dependencies" }, async (progress, token) => {

            if (!(await this.isHomebrewInstalled())) {
                progress.report({ increment: 1 / toolsCount, message: "Installing Homebrew..." });
                if (!(await this.installHomebrew())) {
                    throw Error("Homebrew is not installed");
                }
            }

            if (!(await this.isXcbeautifyInstalled())) {
                progress.report({ increment: 2 / toolsCount, message: "Installing xcbeautify..." });
                if (!(await this.installTool("xcbeautify"))) {
                    throw Error("xcbeautify is not installed");
                }
            }

            if (!(await this.isRubyInstalled())) {
                progress.report({ increment: 3 / toolsCount, message: "Installing Ruby..." });
                if (!(await this.installTool("ruby"))) {
                    throw Error("ruby is not installed");
                }
            }

            if (!(await this.isGemInstalled("xcodeproj"))) {
                progress.report({ increment: 3 / toolsCount, message: "Installing gem xcodeproj..." });
                if (!(await this.installTool("xcodeproj", "gem"))) {
                    throw Error("xcodeproj is not installed");
                }
            }
        });
    }

    public async resolveThirdPartyTools() {
        if (!(await this.isHomebrewInstalled())
            || !(await this.isXcbeautifyInstalled())
            || !(await this.isRubyInstalled())
            || !(await this.isGemInstalled("xcodeproj"))) {
            const option = await vscode.window.showWarningMessage("Required tools are not installed. Without them extension would not work properly. Do you want to Install Them automatically?", "Yes", "No");
            if (option == "Yes") {
                try {
                    // install extensions
                    await this.installTools();
                    this.log.appendLine("All dependencies are installed. You are ready to go");
                } catch (err) {
                    this.log.appendLine(`${err}`);
                }
            }
        } else {
            this.log.appendLine("All dependencies are installed. You are ready to go");
        }
    }
}