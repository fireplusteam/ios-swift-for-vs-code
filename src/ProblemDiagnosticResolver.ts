import { ChildProcess, ChildProcessWithoutNullStreams, ExecFileSyncOptionsWithStringEncoding, SpawnOptions, exec, spawn } from 'child_process';
import { parse } from 'path';
import { stderr } from 'process';
import { start } from 'repl';
import * as vscode from 'vscode';
import { problemDiagnosticResolver, sleep } from './extension';

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
        const options: SpawnOptions = {
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
                this.watcherProc = undefined;
                if (this.isErrorParsed) {
                    vscode.commands.executeCommand('workbench.action.problems.focus');
                }
            }
        });
        let triggerCharacter = type === ProblemDiagnosticLogType.build ? "^" : "\n";
        let decoder = new TextDecoder("utf-8");
        child.stdout?.on("data", (data) => {
            stdout += decoder.decode(data);
            let lastErrorIndex = -1;
            for (let i = firstIndex; i < stdout.length; ++i) {
                if (stdout[i] === triggerCharacter) {
                    lastErrorIndex = i;
                    if (type === ProblemDiagnosticLogType.build && triggerCharacter === '^') {
                        triggerCharacter = "\n";
                        lastErrorIndex = -1;
                    }
                }
            }

            const shouldEnd = stdout.indexOf("■") !== -1;
            if (lastErrorIndex !== -1) {
                triggerCharacter = type === ProblemDiagnosticLogType.build ? "^" : "\n";
                const problems = this.parseBuildLog(stdout.substring(0, lastErrorIndex + 1), type);
                this.storeProblems(type, problems);
                stdout = stdout.substring(lastErrorIndex + 1);
                firstIndex = 0;
            } else {
                firstIndex = stdout.length;
            }
            if (shouldEnd) {
                this.fireEnd.fire(true);
            }
        });
        this.watcherProc = child;
    }

    private problemPattern = /^(.*?):(\d+)(?::(\d+))?:\s+(warning|error|note):\s+(.*)$/gm;

    private column(output: string, messageEnd: number, type: ProblemDiagnosticLogType) {
        if (type === ProblemDiagnosticLogType.tests) {
            return [0, 10000];
        }
        let newLineCounter = 0;
        let str = ""
        let shouldBreak = false;
        for (let i = messageEnd; i < output.length; ++i) {
            if (output[i] === '\n') {
                if (shouldBreak) {
                    break;
                }
                str = "";
                newLineCounter += 1;
            } else {
                str += output[i];
            }
            if (output[i] === '^') {
                shouldBreak = true;
            }
            if (newLineCounter >= 3) {
                break;
            }
        }
        let start = str.length, end = 0;
        for (let i = 0; i < str.length; ++i) {
            if (str[i] !== ' ') {
                start = Math.min(i, start);
                end = Math.max(end, i);
            }
        }
        if (start > end) {
            return [0, 10000];
        }
        return [start, end];
    }

    private parseBuildLog(output: string, type: ProblemDiagnosticLogType) {
        if (type === ProblemDiagnosticLogType.tests) {
        }
        const files: { [key: string]: vscode.Diagnostic[] } = {};
        try {
            let matches = [...output.matchAll(this.problemPattern)];
            for (const match of matches) {
                const file = match[1];
                const line = Number(match[2]) - 1;
                const column = this.column(output, (match?.index || 0) + match[0].length, type);

                const severity = match[4];
                const message = match[5];
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
                        new vscode.Position(line, column[0]),
                        new vscode.Position(line, column[1])),
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