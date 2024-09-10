import { Executor, ExecutorMode, ExecutorReturnType } from "../execShell";
import { getFilePathInWorkspace } from "../env";
import * as vscode from 'vscode';

class XCFileCoverage extends vscode.FileCoverage {
    lineCoverage: vscode.StatementCoverage[] | undefined
}

export class CoverageProvider {
    private xcresultPath: string;

    constructor(xcresultPath: string) {
        this.xcresultPath = getFilePathInWorkspace(xcresultPath);
    }

    public async getCoverageFiles(): Promise<vscode.FileCoverage[]> {
        const tree = await this.getCoverageData();

        const allCoverages = [] as vscode.FileCoverage[];

        for (const target of tree.targets) {
            for (const file of target.files) {
                let fileCoverage = new XCFileCoverage(vscode.Uri.file(file.path), new vscode.TestCoverageCount(file.coveredLines, file.executableLines));
                allCoverages.push(fileCoverage);
            }
        }

        return allCoverages;
    }

    public async getStatementCoverageFor(fileCoverage: vscode.FileCoverage): Promise<vscode.StatementCoverage[]> {
        const command = `xcrun xccov view --archive --json --file '${fileCoverage.uri.fsPath}' '${this.xcresultPath}'`;
        const executor = new Executor();
        const outFileCoverageStr = (await executor.execShell(
            "shellScript",
            command,
            [],
            false,
            ExecutorReturnType.stdout,
            ExecutorMode.silently
        )) as string;
        const coverage = JSON.parse(outFileCoverageStr);

        if (fileCoverage instanceof XCFileCoverage) {
            if (fileCoverage.lineCoverage)
                return fileCoverage.lineCoverage;
            const linesCoverage = [] as vscode.StatementCoverage[];
            const lines = coverage[fileCoverage.uri.fsPath];
            for (const line of lines) {
                if (line.isExecutable) {
                    linesCoverage.push(new vscode.StatementCoverage(
                        line.executionCount,
                        new vscode.Range(new vscode.Position(line.line - 1, 0), new vscode.Position(line.line - 1, 10000))
                    ));
                }
            }
            fileCoverage.lineCoverage = linesCoverage;
            return linesCoverage;
        }
        return [];
    }

    private async getCoverageData() {
        const shell = new Executor();
        const command = `xcrun xccov view --report --json '${this.xcresultPath}'`
        const coverageJsonStr = (await shell.execShell(
            "shellScript",
            command,
            [],
            false,
            ExecutorReturnType.stdout,
            ExecutorMode.silently
        )) as string;

        return JSON.parse(coverageJsonStr);
    }

}