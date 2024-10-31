import { CommandContext } from "../CommandManagement/CommandContext";
import {
    getProjectPath,
    getProjectType,
    isPlatformValid,
    ProjectEnv,
    ProjectFileMissedError,
} from "../env";
import { ExecutorMode } from "../Executor";
import { getProjectFiles } from "../ProjectManager/ProjectManager";

export interface XCodeSettings {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: Promise<any>;
}

export class ProjectSettingsProvider implements XCodeSettings {
    projectEnv: WeakRef<ProjectEnv> | undefined;
    private _context: CommandContext;

    constructor(context: CommandContext) {
        this._context = context;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get settings(): Promise<any> {
        return this.fetchProjectXcodeBuildSettings();
    }

    async fetchSchemes(): Promise<string[]> {
        const projectEnv = this.projectEnv?.deref();
        if (projectEnv === undefined) {
            throw Error("ProjectEnv is not set");
        }
        const json = await this.fetchXcodeList(await projectEnv.projectFile);
        if ((await projectEnv.projectType) === "-workspace") {
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
        const projectEnv = this.projectEnv?.deref();
        if (projectEnv === undefined) {
            throw Error("ProjectEnv is not set");
        }
        const args = ["-scheme", await projectEnv.projectScheme, "-showdestinations", "-json"];
        const projectType = await projectEnv.projectType;
        if (projectType !== "-package") {
            args.push(projectType, await projectEnv.projectFile);
        }
        const result = await this._context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            args: args,
            mode: ExecutorMode.verbose,
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
                    key === "variant" ||
                    key === "arch"
                ) {
                    formattedKey[key] = value;
                }
            }
            if (isValid && isPlatformValid(formattedKey["platform"], formattedKey["variant"])) {
                json.push(formattedKey);
            }
        }

        return json;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static cachedSettings: [string, string, string, any] | undefined = undefined;

    private async fetchProjectXcodeBuildSettings() {
        const projectEnv = this.projectEnv?.deref();
        if (projectEnv === undefined) {
            throw Error("ProjectEnv is not set");
        }
        const projectFile = await projectEnv.projectFile;
        const scheme = await projectEnv.projectScheme;
        const buildConfiguration = await projectEnv.projectConfiguration;

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
            mode: ExecutorMode.verbose,
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
        if (getProjectType(projectFile) !== "-package") {
            args.push(getProjectType(projectFile), projectFile);
        }
        const result = await this._context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            args: args,
            mode: ExecutorMode.onlyCommandNameAndResult,
        });
        const json = JSON.parse(result.stdout);

        return json;
    }
}
