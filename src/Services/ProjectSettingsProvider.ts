import { CommandContext } from "../CommandManagement/CommandContext";
import { getProjectType, ProjectEnv } from "../env";

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
        const json = await this.getXcodeList();
        if (await this.projectEnv.projectType == "-workspace") {
            return json.workspace.schemes;
        }
        return json.project.schemes;
    }

    async getConfigurations(): Promise<string[]> {
        const json = await this.getXcodeList();
        return json.project.configurations;
    }

    private async getXcodeList() {
        const projectFile = await this._projectEnv.projectFile;
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