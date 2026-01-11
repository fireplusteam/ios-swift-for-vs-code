import * as vscode from "vscode";
import { glob } from "glob";
import { buildTestsForCurrentFile } from "../buildCommands";
import { CommandContext } from "../CommandManagement/CommandContext";
import { ProblemDiagnosticResolver } from "../ProblemDiagnosticResolver";
import { getProductDir } from "../env";
import { XCRunHelper } from "../Tools/XCRunHelper";

type XCTestRunFile = {
    file: string;
    stat: Thenable<vscode.FileStat>;
};

export type XCTestTarget = {
    target: string;
    host: string;
    testRun: string;
};

export class XCTestRunInspector {
    constructor(private problemResolver: ProblemDiagnosticResolver) {}

    async build(
        context: CommandContext,
        tests: string[],
        selectedTestPlan: string | undefined,
        isCoverage: boolean
    ) {
        const existingFiles = await this.getAllXCRunFiles();
        await buildTestsForCurrentFile(
            context,
            this.problemResolver,
            tests,
            selectedTestPlan,
            isCoverage
        );
        const changedFiles = await this.getChangedFiles(existingFiles);
        const targets = await this.parseXCRun(changedFiles, selectedTestPlan);
        if (tests) {
            const testsTargets = tests.map(test => test.split("/").at(0));
            return targets.filter(target => testsTargets.includes(target.target));
        } else {
            return targets;
        }
    }

    private async getAllXCRunFiles(): Promise<XCTestRunFile[]> {
        const files = await glob("*.xctestrun", {
            absolute: true,
            cwd: await getProductDir(),
        });
        return files.map(file => {
            return { file: file, stat: vscode.workspace.fs.stat(vscode.Uri.file(file)) };
        });
    }

    private async getChangedFiles(beforeBuildFiles: XCTestRunFile[]) {
        const afterBuildFiles = await this.getAllXCRunFiles();
        const changedFiles: string[] = [];
        for (const afterFile of afterBuildFiles) {
            const index = beforeBuildFiles.findIndex(value => value.file === afterFile.file);
            if (index !== -1) {
                // found, check if the file was changed during a build command
                if ((await afterFile.stat).mtime !== (await beforeBuildFiles[index].stat).mtime) {
                    changedFiles.push(afterFile.file);
                }
            } else {
                // it's a new file
                changedFiles.push(afterFile.file);
            }
        }
        return changedFiles;
    }

    private async parseXCRun(
        testRuns: string[],
        selectedTestPlan: string | undefined
    ): Promise<XCTestTarget[]> {
        let selectedTestRun: any | null = null;
        let selectedFile: string = "";
        for (const testRun of testRuns) {
            const stdout = await XCRunHelper.convertPlistToJson(testRun);
            const json = JSON.parse(stdout);
            if (testRuns.length === 1) {
                selectedTestRun = json;
                selectedFile = testRun;
                break;
            } else if (selectedTestPlan === undefined) {
                if (json.TestPlan?.IsDefault === true) {
                    // set default as it was not preselected by a user
                    selectedTestRun = json;
                    selectedFile = testRun;
                    break;
                }
            } else if (json.TestPlan?.Name === selectedTestPlan) {
                selectedFile = testRun;
                selectedTestRun = json;
                break;
            }
        }
        const result: XCTestTarget[] = [];
        if (selectedTestRun !== null) {
            // parse configs to targets
            let configurations = selectedTestRun.TestConfigurations;
            if (configurations === undefined) {
                const testTargets = [];
                for (const key in selectedTestRun) {
                    if (selectedTestRun[key].BlueprintName !== undefined) {
                        testTargets.push(selectedTestRun[key]);
                    }
                }
                configurations = [{ TestTargets: testTargets }];
            }
            for (const config of configurations) {
                for (const testTarget of config.TestTargets) {
                    // __TESTROOT__ needs to be replaced with the product dir, for tests built for products
                    // __PLATFORMS__ needs to be replaced with the Xcode platforms path, for Package.swift based tests as it runs with xctest
                    const hostPath = testTarget.TestHostPath.replace(
                        "__TESTROOT__/",
                        await getProductDir()
                    ).replace("__PLATFORMS__", `${await XCRunHelper.getXcodePath()}/Platforms`);

                    result.push({
                        target: testTarget.BlueprintName,
                        host: hostPath,
                        testRun: selectedFile,
                    });
                }
            }
        }
        return result;
    }
}
