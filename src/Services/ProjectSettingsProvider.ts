import { CommandContext } from "../CommandManagement/CommandContext";
import { getProjectPath, getProjectType, ProjectEnv, ProjectFileMissedError } from "../env";
import { getProjectFiles } from "../ProjectManager/ProjectManager";

export interface XCodeSettings {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: Promise<any>;
}

export class ProjectSettingsProvider implements XCodeSettings {
    private _projectEnv: ProjectEnv;
    get projectEnv(): ProjectEnv {
        return this._projectEnv;
    }
    private _context: CommandContext;

    constructor(context: CommandContext) {
        this._context = context;
        this._projectEnv = new ProjectEnv(this);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get settings(): Promise<any> {
        return this.fetchProjectXcodeBuildSettings();
    }

    async fetchSchemes(): Promise<string[]> {
        const json = await this.fetchXcodeList(await this._projectEnv.projectFile);
        if ((await this.projectEnv.projectType) === "-workspace") {
            return json.workspace.schemes;
        }
        return json.project.schemes;
    }

    async fetchConfigurations(): Promise<string[]> {
        const projectFile = (await getProjectFiles(await getProjectPath())).at(0);
        if (projectFile === undefined) {
            throw ProjectFileMissedError;
        }
        const json = await this.fetchXcodeList(projectFile);
        return json.project.configurations;
    }

    async fetchDevices() {
        const args = ["-scheme", await this.projectEnv.projectScheme, "-showdestinations", "-json"];
        const projectType = await this.projectEnv.projectType;
        if (projectType !== "-package") {
            args.push(projectType, await this.projectEnv.projectFile);
        }
        const result = await this._context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            args: args,
        });

        const devices = result.stdout.split("\n").filter(e => e.indexOf("platform:") !== -1);

        const json = [];
        for (const deviceLine of devices) {
            const formatted = deviceLine
                .replace("{", "")
                .replace("}", "")
                .trim()
                .split(", ")
                .map(e => e.trim());

            let isValid = true;
            const formattedKey: { [name: string]: string } = {};
            for (const i of formatted) {
                const sepPos = i.indexOf(":");
                if (sepPos === -1) {
                    isValid = false;
                    break;
                }
                const [key, value] = [i.substring(0, sepPos), i.substring(sepPos + 1)];
                if (
                    key === "OS" ||
                    key === "name" ||
                    key === "platform" ||
                    key === "id" ||
                    key === "variant"
                ) {
                    formattedKey[key] = value;
                }
            }
            if (isValid) json.push(formattedKey);
        }

        return json;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static cachedSettings: [string, string, string, any] | undefined = undefined;

    private async fetchProjectXcodeBuildSettings() {
        const projectFile = await this.projectEnv.projectFile;
        const scheme = await this.projectEnv.projectScheme;
        const buildConfiguration = await this.projectEnv.projectConfiguration;

        if (ProjectSettingsProvider.cachedSettings) {
            const [_pF, _pS, _bC, _settings] = ProjectSettingsProvider.cachedSettings;
            if (_pF === projectFile && _pS === scheme && _bC === buildConfiguration) {
                return _settings;
            }
        }

        const settings = await this._context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            args: [
                "-showBuildSettings",
                getProjectType(projectFile),
                projectFile,
                "-scheme",
                scheme,
                "-configuration",
                buildConfiguration,
                "-json",
            ],
        });
        const jsonSettings = JSON.parse(settings.stdout);
        ProjectSettingsProvider.cachedSettings = [
            projectFile,
            scheme,
            buildConfiguration,
            jsonSettings,
        ];

        return jsonSettings;
    }

    private async fetchXcodeList(projectFile: string) {
        const args = ["-list", "-json"];
        if ((await getProjectType(projectFile)) !== "-package") {
            args.push(getProjectType(projectFile), projectFile);
        }
        const result = await this._context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            args: args,
        });
        const json = JSON.parse(result.stdout);

        return json;
    }
}
