import { getFilePathInWorkspace } from "../env";
import * as fs from "fs";
import path = require("path");

export class PackageWorkspaceGenerator {
    readonly workspaceDummyFile = getFilePathInWorkspace("Workspace.swift");
    constructor() {}

    generateDummyWorkspaceSwiftFile(swiftPackagePath: string) {
        return;
        // commented out for now as it causes issues with LSP client
        const packagePath = swiftPackagePath.split(path.sep).slice(0, -1).join(path.sep);
        const workspacePath = this.workspaceDummyFile.split(path.sep).slice(0, -1).join(path.sep);
        const relativePath = path.relative(workspacePath, packagePath);
        const template = `
import ProjectDescription

let workspace = Workspace(
    name: "Workspace", // The name of your .xcworkspace
    projects: [
        "${relativePath}"
    ]
)`;
        fs.writeFileSync(this.workspaceDummyFile, template);
    }
}
