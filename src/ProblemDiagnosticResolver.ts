import { ChildProcess, SpawnOptions, spawn } from 'child_process';
import * as vscode from 'vscode';

export enum ProblemDiagnosticLogType {
    build,
    tests
}

export class ProblemDiagnosticResolver {

    disposable: vscode.Disposable[] = [];
    diagnosticBuildCollection: vscode.DiagnosticCollection;
    diagnosticTestsCollection: vscode.DiagnosticCollection;
    isErrorParsed = false;

    buildErrors = new Set<string>();

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
                this.buildErrors.clear();
                this.diagnosticBuildCollection.forEach((uri, _) => {
                    this.buildErrors.add(uri.fsPath);
                });
                break;
            case ProblemDiagnosticLogType.tests:
                this.diagnosticTestsCollection.clear();
                break;
        }
    }

    private uniqueProblems(list: vscode.Diagnostic[], sourcekitList: vscode.Diagnostic[]) {
        function compareRanges(range1: vscode.Range, range2: vscode.Range): number {
            if (range1.start.line !== range2.start.line)
                return range1.start.line - range2.start.line;
            if (range1.start.character !== range2.start.character)
                return range1.start.character - range2.start.character;
            if (range1.end.line !== range2.end.line)
                return range1.end.line - range2.end.line;
            if (range1.end.character !== range2.end.character)
                return range1.end.character - range2.end.character;
            return 0;
        }
        
        function comp(a: vscode.Diagnostic, b: vscode.Diagnostic, comp: (a: vscode.Range, b: vscode.Range) => number = compareRanges) {
            if (a.message.toLowerCase() !== b.message.toLowerCase()) {
                return a.message.toLowerCase() < b.message.toLowerCase() ? -1 : 1;
            }
            if (a.severity !== b.severity) {
                return a.severity - b.severity;
            }
            if (a.range.isEqual(b.range) === false) {
                return comp(a.range, b.range);
            }
            return 0;
        }
        list.sort(comp);
        let res: vscode.Diagnostic[] = [];
        for (let i = 0; i < list.length; ++i) {
            if (res.length == 0 || comp(list[i], res[res.length - 1]) !== 0) {
                if (sourcekitList.find((v) => {
                    return comp(v, list[i], (a, b) => {
                        if (a.start.line !== b.start.line)
                            return a.start.line - b.start.line;
                        if (a.end.line !== b.end.line)
                            return a.end.line - b.end.line;
                        return 0;
                    }) === 0;
                }) === undefined) {
                    res.push(list[i]);
                }
            }
        }
        return res;
    }

    private globalProblems(file: vscode.Uri) {
        return vscode.languages.getDiagnostics(file).filter((e) => {
            return e.source !== "xcodebuild" && e.source !== "xcodebuild-tests";
        });
    }

    private storeProblems(type: ProblemDiagnosticLogType, files: { [key: string]: vscode.Diagnostic[] }) {
        if (Object.keys(files).length > 0) {
            this.isErrorParsed = true;
        }
        for (let file in files) {
            const fileUri = vscode.Uri.file(file); 
            switch (type) {
                case ProblemDiagnosticLogType.build:
                    if (this.buildErrors.delete(file)) {
                        this.diagnosticBuildCollection.delete(fileUri);
                    }
                    let list = [
                        ...this.diagnosticBuildCollection.get(fileUri) || [],
                        ...files[file]
                    ];
                    this.diagnosticBuildCollection.set(fileUri, this.uniqueProblems(list, this.globalProblems(fileUri)));
                    break;
                case ProblemDiagnosticLogType.tests:
                    let listTests = [
                        ...this.diagnosticTestsCollection.get(fileUri) || [],
                        ...files[file]
                    ];
                    this.diagnosticTestsCollection.set(fileUri, this.uniqueProblems(listTests, this.globalProblems(fileUri)));
                    break;
            }
        }
    }

    parseAsyncLogs(workspacePath: string, filePath: string, type: ProblemDiagnosticLogType, showProblemPanelOnError = true) {
        if (this.watcherProc !== undefined) {
            this.watcherProc.kill();
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
        let triggerCharacter = type === ProblemDiagnosticLogType.build ? "^" : "\n";
        let decoder = new TextDecoder("utf-8");
        child.stdout?.on("data", async (data) => {
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
                if (type === ProblemDiagnosticLogType.build) {
                    for (let file of this.buildErrors) {
                        this.diagnosticBuildCollection.delete(vscode.Uri.file(file));
                    }
                    this.buildErrors.clear;
                }
                child.kill();
            }
        });
        child.on("exit", () => {
            if (child === this.watcherProc) {
                this.watcherProc = undefined;
                if (showProblemPanelOnError && this.isErrorParsed) {
                    vscode.commands.executeCommand('workbench.action.problems.focus');
                }
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