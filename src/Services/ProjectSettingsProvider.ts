import { CommandContext } from "../CommandManagement/CommandContext";
import {
    getFilePathInWorkspace,
    getProjectType,
    isPlatformValid,
    NoAvailableSchemesForProjectError,
    ProjectEnv,
    ProjectFileMissedError,
} from "../env";
import { ExecutorMode } from "../Executor";
import { getRootProjectFilePath } from "../ProjectManager/ProjectManager";
import { CustomError } from "../utils";
import * as path from "path";
import * as glob from "glob";
import * as fs from "fs";
import { BuildManager } from "./BuildManager";

export interface XCodeSettings {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: Promise<any>;
}

export const TestPlanIsNotConfigured = new CustomError("Test Plan is not configured");

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

    async getSettingsForScheme(scheme: string): Promise<any> {
        return this.fetchProjectXcodeBuildSettings(scheme);
    }

    get testPlans(): Promise<string[]> {
        return this.fetchTestPlan();
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
        if (
            json.project.schemes === null ||
            json.project.schemes === undefined ||
            json.project.schemes.length === 0
        ) {
            throw NoAvailableSchemesForProjectError;
        }
        return json.project.schemes;
    }

    async rootProjectSchemes(): Promise<string[]> {
        const relativeProjectPath = await getRootProjectFilePath();
        if (relativeProjectPath === undefined) {
            throw ProjectFileMissedError;
        }
        const schemeDir = path.join(
            getFilePathInWorkspace(relativeProjectPath),
            "xcshareddata",
            "xcschemes"
        );
        const schemes: string[] = [];

        if (fs.existsSync(schemeDir)) {
            const globPattern = path.join(schemeDir, "*.xcscheme");
            const files = await glob.glob(globPattern);
            for (const file of files) {
                schemes.push(path.basename(file, ".xcscheme"));
            }
        }
        return schemes;
    }

    async fetchConfigurations(): Promise<string[]> {
        const projectFile = await getRootProjectFilePath();
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
        const args = [
            "-scheme",
            await projectEnv.projectScheme,
            "-showdestinations",
            "-json",
            "-disableAutomaticPackageResolution",
            "-skipPackageUpdates",
        ];
        const projectType = await projectEnv.projectType;
        args.push(projectType, await projectEnv.projectFile);
        const result = await this._context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            args: args,
            mode: ExecutorMode.verbose,
            env: { ...(await BuildManager.commonEnv()) },
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
    private static cachedTestPlans: [string, string[]] | undefined = undefined;
    private async fetchTestPlan() {
        const scheme = await this._context.projectEnv.projectScheme;
        if (ProjectSettingsProvider.cachedTestPlans) {
            const [cachedScheme, cachedTestPlans] = ProjectSettingsProvider.cachedTestPlans;
            if (cachedScheme === scheme) {
                return cachedTestPlans;
            }
        }
        try {
            const result = await this._context.execShellWithOptions({
                scriptOrCommand: { command: "xcodebuild" },
                args: [
                    "test",
                    await this._context.projectEnv.projectType,
                    await this._context.projectEnv.projectFile,
                    "-scheme",
                    scheme,
                    "-showTestPlans",
                    "-json",
                    "-disableAutomaticPackageResolution",
                    "-skipPackageUpdates",
                ],
                env: { ...(await BuildManager.commonEnv()) },
                mode: ExecutorMode.onlyCommandNameAndResult,
            });
            // this._context.log.appendLine(result.stdout);
            const json = JSON.parse(result.stdout);
            if (json.testPlans === null) {
                ProjectSettingsProvider.cachedTestPlans = [scheme, []];
                return [];
            }
            const testPlans = json.testPlans.map((e: any) => e.name);
            ProjectSettingsProvider.cachedTestPlans = [scheme, testPlans];
            return testPlans;
        } catch (error) {
            if (
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                error.code === 66 // test plan is not configured
            ) {
                throw TestPlanIsNotConfigured;
            } else {
                throw error;
            }
        }
    }

    static cleanCache() {
        ProjectSettingsProvider.cachedSettings = [];
        ProjectSettingsProvider.cachedTestPlans = undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static cachedSettings: [string, string, string, any][] = [];
    private async fetchProjectXcodeBuildSettings(scheme?: string) {
        const projectEnv = this.projectEnv?.deref();
        if (projectEnv === undefined) {
            throw Error("ProjectEnv is not set");
        }
        const projectFile = await projectEnv.projectFile;
        scheme = scheme ?? (await projectEnv.projectScheme);
        const buildConfiguration = await projectEnv.projectConfiguration;

        if (ProjectSettingsProvider.cachedSettings) {
            for (const cachedSetting of ProjectSettingsProvider.cachedSettings) {
                const [_pF, _pS, _bC, _settings] = cachedSetting;
                if (_pF === projectFile && _pS === scheme && _bC === buildConfiguration) {
                    return _settings;
                }
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
                "-disableAutomaticPackageResolution",
                "-skipPackageUpdates",
                "-skipPackagePluginValidation",
                "-skipMacroValidation",
                "-skipPackageSignatureValidation",
            ],
            env: { ...(await BuildManager.commonEnv()) },
            mode: ExecutorMode.onlyCommandNameAndResult,
        });
        const jsonSettings = JSON.parse(settings.stdout);
        ProjectSettingsProvider.cachedSettings.push([
            projectFile,
            scheme,
            buildConfiguration,
            jsonSettings,
        ]);

        return jsonSettings;
    }

    private async fetchXcodeList(projectFile: string) {
        const args = ["-list", "-json"];
        args.push(getProjectType(projectFile), projectFile);
        const result = await this._context.execShellWithOptions({
            scriptOrCommand: { command: "xcodebuild" },
            args: args,
            mode: ExecutorMode.onlyCommandNameAndResult,
            env: { ...(await BuildManager.commonEnv()) },
        });
        const json = JSON.parse(result.stdout);

        return json;
    }
}
