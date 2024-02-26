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
    isErrorParsed = false;

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

        tokens[2] = "_".repeat((matchStart?.index || 1) - 1) + tokens[2].slice(matchStart?.index || 0);
        return tokens.join("\n");
    }

    private transformTestMessage(message: string, line: number) {
        return message;
    }

    private watcherProc: ChildProcess | undefined;

    private clear(type: ProblemDiagnosticLogType) {
        this.isErrorParsed = false;
        switch (type) {
            case ProblemDiagnosticLogType.build:
                this.diagnosticBuildCollection.clear();
                break;
            case ProblemDiagnosticLogType.tests:
                this.diagnosticTestsCollection.clear();
                break;
        }
    }

    private storeProblems(type: ProblemDiagnosticLogType, files: { [key: string]: vscode.Diagnostic[] }) {
        if (Object.keys(files).length > 0) {
            this.isErrorParsed = true;
        }
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

    fireEnd = new vscode.EventEmitter<boolean>();
    endDisposable: vscode.Disposable | null = null;

    parseAsyncLogs(workspacePath: string, filePath: string, type: ProblemDiagnosticLogType) {
        if (this.watcherProc !== undefined) {
            this.watcherProc.kill();
            this.watcherProc = undefined;
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
        this.endDisposable = this.fireEnd.event((e) => {
            if (e) {
                this.watcherProc?.kill();
                this.watcherProc?.kill();
                this.watcherProc = undefined;
                if (this.isErrorParsed) {
                    vscode.commands.executeCommand('workbench.action.problems.focus');
                }
            }
        });
        child.stdout?.on("data", (data) => {
            stdout += data.toString();
            let lastErrorIndex = -1;
            let nextErrorIndex = firstIndex - 1; 
            while (nextErrorIndex !== -1) {
                switch (type) {
                    case ProblemDiagnosticLogType.build:
                        nextErrorIndex = stdout.indexOf("^", nextErrorIndex + 1);
                        break;
                    case ProblemDiagnosticLogType.tests:
                        nextErrorIndex = stdout.lastIndexOf("\n", nextErrorIndex + 1);
                        break;
                }
                if (nextErrorIndex !== -1) {
                    lastErrorIndex = nextErrorIndex;
                }
            }
            if (stdout.indexOf("■") !== -1) {
                this.fireEnd.fire(true);
            }
            if (lastErrorIndex !== -1) {
                const problems = this.parseBuildLog(stdout.substring(0, lastErrorIndex + 1), type);
                this.storeProblems(type, problems);
                stdout = stdout.substring(lastErrorIndex + 1);
                firstIndex = 0;
            } else {
                firstIndex = stdout.length;
            }
        });
        this.watcherProc = child;
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