/// Ruby scripts

import { XcodeProjectFileProxy } from "./XcodeProjectFileProxy";

export interface RubyProjectFilesManagerInterface {
    getProjectTargets(projectFile: string): Promise<string[]>;
    addFileToProject(projectFile: string, target: string, file: string): Promise<string[]>;
    addFolderToProject(projectFile: string, folder: string): Promise<string[]>;
    updateFileToProject(projectFile: string, target: string, file: string): Promise<string[]>;
    renameFileToProject(projectFile: string, oldFile: string, file: string): Promise<string[]>;
    moveFileToProject(projectFile: string, oldFile: string, file: string): Promise<string[]>;
    renameFolderToProject(
        projectFile: string,
        oldFolder: string,
        newFolder: string
    ): Promise<string[]>;
    moveFolderToProject(
        projectFile: string,
        oldFolder: string,
        newFolder: string
    ): Promise<string[]>;
    listFilesFromProject(projectFile: string): Promise<string[]>;
    listFilesFromTarget(projectFile: string, targetName: string): Promise<string[]>;
    deleteFileFromProject(projectFile: string, file: string): Promise<string[]>;
    deleteFolderFromProject(projectFile: string, folder: string): Promise<string[]>;
    listTargetsForFile(projectFile: string, file: string): Promise<string[]>;
    saveProject(projectFile: string): Promise<string[]>;
}

export class RubyProjectFilesManager implements RubyProjectFilesManagerInterface {
    private readonly xcodeProjects = new Map<string, XcodeProjectFileProxy>();

    constructor() {}

    private async executeRuby(projectPath: string, command: string): Promise<string[]> {
        if (!this.xcodeProjects.has(projectPath)) {
            this.xcodeProjects.set(projectPath, new XcodeProjectFileProxy(projectPath));
        }
        return (await this.xcodeProjects.get(projectPath)?.request(command)) || [];
    }

    async getProjectTargets(projectFile: string) {
        return await this.executeRuby(projectFile, `list_targets`);
    }

    async addFileToProject(projectFile: string, target: string, file: string) {
        return await this.executeRuby(projectFile, `add_file|^|^|${target}|^|^|${file}`);
    }

    async addFolderToProject(projectFile: string, folder: string) {
        return await this.executeRuby(projectFile, `add_group|^|^|${folder}`);
    }

    async updateFileToProject(projectFile: string, target: string, file: string) {
        return await this.executeRuby(projectFile, `update_file_targets|^|^|${target}|^|^|${file}`);
    }

    async renameFileToProject(projectFile: string, oldFile: string, file: string) {
        return await this.executeRuby(projectFile, `rename_file|^|^|${oldFile}|^|^|${file}`);
    }

    async moveFileToProject(projectFile: string, oldFile: string, file: string) {
        return await this.executeRuby(projectFile, `move_file|^|^|${oldFile}|^|^|${file}`);
    }

    async renameFolderToProject(projectFile: string, oldFolder: string, newFolder: string) {
        return await this.executeRuby(
            projectFile,
            `rename_group|^|^|${oldFolder}|^|^|${newFolder}`
        );
    }

    async moveFolderToProject(projectFile: string, oldFolder: string, newFolder: string) {
        return await this.executeRuby(projectFile, `move_group|^|^|${oldFolder}|^|^|${newFolder}`);
    }

    async listFilesFromProject(projectFile: string) {
        return await this.executeRuby(projectFile, `list_files|^|^|`);
    }

    async listFilesFromTarget(projectFile: string, targetName: string) {
        return await this.executeRuby(projectFile, `list_files_for_target|^|^|${targetName}`);
    }

    async deleteFileFromProject(projectFile: string, file: string) {
        return await this.executeRuby(projectFile, `delete_file|^|^|${file}`);
    }

    async deleteFolderFromProject(projectFile: string, folder: string) {
        return await this.executeRuby(projectFile, `delete_group|^|^|${folder}`);
    }

    async listTargetsForFile(projectFile: string, file: string) {
        return await this.executeRuby(projectFile, `list_targets_for_file|^|^|${file}`);
    }

    async saveProject(projectFile: string) {
        return await this.executeRuby(projectFile, "save");
    }
}
