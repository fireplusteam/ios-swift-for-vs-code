import { CommandContext } from "../CommandManagement/CommandContext";
import { getFilePathInWorkspace, getProjectPath, getProjectType, ProjectEnv, ProjectFileMissedError } from "../env";
import { getProjectFiles } from "../ProjectManager/ProjectManager";
import fs from "fs";

export class ProjectSettingsProvider {
    private _projectEnv = new ProjectEnv();
    get projectEnv(): ProjectEnv {
        return this._projectEnv;
    }
    private _context: CommandContext

    constructor(context: CommandContext) {
        this._context = context;
    }

    async getSchemes(): Promise<string[]> {
        const json = await this.getXcodeList(await this._projectEnv.projectFile);
        if (await this.projectEnv.projectType == "-workspace") {
            return json.workspace.schemes;
        }
        return json.project.schemes;
    }

    async getConfigurations(): Promise<string[]> {
        const projectFile = (await getProjectFiles(await getProjectPath())).at(0);
        if (projectFile == undefined) {
            throw ProjectFileMissedError;
        }
        const json = await this.getXcodeList(projectFile);
        return json.project.configurations;
    }

    async getDevices() {
        const args = ["-scheme", await this.projectEnv.projectScheme, "-showdestinations", "-json"];
        const projectType = await this.projectEnv.projectType;
        if (projectType != "-package") {
            args.push(projectType, await this.projectEnv.projectFile);
        }
        const result = await this._context.execShellWithOptions({
            terminalName: "Fetch Devices",
            scriptOrCommand: { command: "xcodebuild" },
            args: args
        });

        const devices = result.stdout.split("\n")
            .filter(e => e.indexOf("platform:") != -1);

        const json = [];
        for (const deviceLine of devices) {
            const formatted = deviceLine.replace("{", "").replace("}", "").trim().split(", ").map(e => e.trim());

            let isValid = true;
            const formattedKey: { [name: string]: string } = {};
            for (const i of formatted) {
                const sepPos = i.indexOf(":");
                if (sepPos == -1) {
                    isValid = false;
                    break;
                }
                const [key, value] = [i.substring(0, sepPos), i.substring(sepPos + 1)];
                if (key == "OS" || key == "name" || key == "platform" || key == "id" || key == "variant") {
                    formattedKey[key] = value;
                }
            }
            if (isValid)
                json.push(formattedKey);
        }

        return json;
    }

    private async getXcodeList(projectFile: string) {
        const args = ["-list", "-json"];
        if (await getProjectType(projectFile) != "-package") {
            args.push(getProjectType(projectFile), projectFile);
        }
        const result = await this._context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            args: args
        });
        const json = JSON.parse(result.stdout);

        return json;
    }
}