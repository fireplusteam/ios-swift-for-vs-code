import { ChildProcess, ChildProcessWithoutNullStreams, ExecFileSyncOptionsWithStringEncoding, exec, spawn } from 'child_process';
import { parse } from 'path';
import { stderr } from 'process';
import { start } from 'repl';
import * as vscode from 'vscode';
import { sleep } from './extension';

export enum ProblemDiagnosticLogType {
    build,
    tests
}

export class ProblemDiagnosticResolver {

    disposable: vscode.Disposable[] = [];
    diagnosticBuildCollection: vscode.DiagnosticCollection;
    diagnosticTestsCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticBuildCollection = vscode.languages.createDiagnosticCollection("xcodebuild");
        this.diagnosticTestsCollection = vscode.languages.createDiagnosticCollection("xcodebuild-tests");

        this.disposable.push(vscode.workspace.onDidChangeTextDocument((e) => {
            const fileUrl = e.document.uri;
            if (fileUrl === undefined) { return; }
            this.diagnosticBuildCollection.set(fileUrl, []);
        }));
    }

    private transformBuildMessage(message: string) {
        const tokens = message.split("\n");
        const start = /\S/;
        let matchStart = tokens[1].match(start);
        if (matchStart === undefined) {
            return message;
        }
        tokens[1] = tokens[1].slice(matchStart?.index);
        tokens[2] = tokens[2].slice(matchStart?.index);
        matchStart = tokens[2].match(start);

        tokens[2] = "_".repeat(matchStart?.index || 0) + tokens[2].slice(matchStart?.index || 0);
        return tokens.join("\n");
    }

    private transformTestMessage(message: string, line: number) {
        return message;
    }

    private watcherProc: ChildProcess | undefined;

    clear(type: ProblemDiagnosticLogType) {
        switch (type) {
            case ProblemDiagnosticLogType.build:
                this.diagnosticBuildCollection.clear();
                break;
            case ProblemDiagnosticLogType.tests:
                this.diagnosticTestsCollection.clear();
                break;
        }
    }

    storeProblems(type: ProblemDiagnosticLogType, files: { [key: string]: vscode.Diagnostic[] }) {
        for (let file in files) {
            switch (type) {
                case ProblemDiagnosticLogType.build:
                    let list = [
                        ...this.diagnosticBuildCollection.get(vscode.Uri.file(file)) || [],
                        ...files[file]
                    ];
                    this.diagnosticBuildCollection.set(vscode.Uri.file(file), list);
                    break;
                case ProblemDiagnosticLogType.tests:
                    let listTests = [
                        ...this.diagnosticTestsCollection.get(vscode.Uri.file(file)) || [],
                        ...files[file]
                    ];
                    this.diagnosticTestsCollection.set(vscode.Uri.file(file), listTests);
                    break;
            }
        }
    }

    parseAsyncLogs(workspacePath: string, filePath: string, type: ProblemDiagnosticLogType) {
        if (this.watcherProc !== undefined) {
            throw Error("Logs are parsing");
        }
        const options: ExecFileSyncOptionsWithStringEncoding = {
            encoding: "utf-8",
            cwd: workspacePath,
            shell: true,
            stdio: "pipe"
        }
        const child = spawn(
            `tail`,
            ["-f", `"${filePath}"`],
            options
        );

        this.clear(type);
        var firstIndex = 0; 
        var stdout = "";
        child.stdout?.on("data", (data) => {
            stdout += data.toString();
            let lastErrorIndex = stdout.lastIndexOf("^", firstIndex);

            switch (type) {
                case ProblemDiagnosticLogType.build:
                    break;
                case ProblemDiagnosticLogType.tests:
                    lastErrorIndex = stdout.lastIndexOf("\n", firstIndex);
                    break;
            }

            if (lastErrorIndex !== -1) {
                const problems = this.parseBuildLog(stdout.slice(0, lastErrorIndex + 1), type);
                this.storeProblems(type, problems);
                stdout = stdout.slice(lastErrorIndex + 1);
                firstIndex = 0;
            } else {
                firstIndex = stdout.length;
            }
        });
        this.watcherProc = child;
    }

    async finishParsingLogs() {
        await sleep(1500);
        this.watcherProc?.kill();
        this.watcherProc = undefined;
    }

    private parseBuildLog(output: string, type: ProblemDiagnosticLogType) {
        let rg = /(.*?):(\d+)(?::(\d+))?:\s+(warning|error|note):\s+([\s\S]*?\^)/g;
        if (type === ProblemDiagnosticLogType.tests) {
            rg = /(.*?):(\d+)(?::(\d+))?:\s+(warning|error|note):\s+(.*)/g;
        }
        const files: { [key: string]: vscode.Diagnostic[] } = {};
        try {
            let matches = [...output.matchAll(rg)];
            for (const match of matches) {
                const file = match[1];
                const line = Number(match[2]) - 1;
                const column = Number(match[3]) - 1;
                const severity = match[4];
                const message = type === ProblemDiagnosticLogType.build ? this.transformBuildMessage(match[5]) : this.transformTestMessage(match[5], line);
                let errorSeverity = vscode.DiagnosticSeverity.Error;

                switch (severity) {
                    case "warning":
                        errorSeverity = vscode.DiagnosticSeverity.Warning;
                        break;
                    case "note":
                        errorSeverity = vscode.DiagnosticSeverity.Information;
                        break;
                    default: break;
                }

                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(
                        new vscode.Position(line, column),
                        new vscode.Position(line, column)),
                    message,
                    errorSeverity
                );
                diagnostic.source = type === ProblemDiagnosticLogType.build ? "xcodebuild" : "xcodebuild-tests";
                const value = files[file] || [];
                value.push(diagnostic);
                files[file] = value;
            }
        } catch (err) {
            console.log(err);
        }
        return files;
    }
}