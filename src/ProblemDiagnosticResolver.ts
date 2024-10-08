import { ChildProcess, SpawnOptions, spawn } from "child_process";
import * as fs from "fs";
import path from "path";
import * as vscode from "vscode";

export class ProblemDiagnosticResolver {
    disposable: vscode.Disposable[] = [];
    diagnosticBuildCollection: vscode.DiagnosticCollection;

    buildErrors = new Set<string>();
    buildLogFile: string | undefined;

    constructor() {
        this.diagnosticBuildCollection = vscode.languages.createDiagnosticCollection("xcodebuild");

        this.disposable.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                const fileUrl = e.document.uri;
                if (fileUrl === undefined) {
                    return;
                }
                if (fileUrl.fsPath.endsWith(".log")) return;
                this.diagnosticBuildCollection.set(fileUrl, []);
            })
        );
    }

    private watcherProc: ChildProcess | undefined;

    private clear() {
        this.buildErrors.clear();
        this.diagnosticBuildCollection.forEach(uri => {
            this.buildErrors.add(uri.fsPath);
        });
    }

    private uniqueProblems(list: vscode.Diagnostic[], sourcekitList: vscode.Diagnostic[]) {
        function compareRanges(range1: vscode.Range, range2: vscode.Range): number {
            if (range1.start.line !== range2.start.line)
                return range1.start.line - range2.start.line;
            if (range1.start.character !== range2.start.character)
                return range1.start.character - range2.start.character;
            if (range1.end.line !== range2.end.line) return range1.end.line - range2.end.line;
            if (range1.end.character !== range2.end.character)
                return range1.end.character - range2.end.character;
            return 0;
        }

        function comp(
            a: vscode.Diagnostic,
            b: vscode.Diagnostic,
            comp: (a: vscode.Range, b: vscode.Range) => number = compareRanges
        ) {
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
        const res: vscode.Diagnostic[] = [];
        for (let i = 0; i < list.length; ++i) {
            if (res.length === 0 || comp(list[i], res[res.length - 1]) !== 0) {
                if (
                    sourcekitList.find(v => {
                        return (
                            comp(v, list[i], (a, b) => {
                                if (a.start.line !== b.start.line)
                                    return a.start.line - b.start.line;
                                if (a.end.line !== b.end.line) return a.end.line - b.end.line;
                                return 0;
                            }) === 0
                        );
                    }) === undefined
                ) {
                    res.push(list[i]);
                }
            }
        }
        return res;
    }

    private globalProblems(file: vscode.Uri) {
        return vscode.languages.getDiagnostics(file).filter(e => {
            return e.source !== "xcodebuild" && e.source !== "xcodebuild-tests";
        });
    }

    private storeProblems(files: { [key: string]: vscode.Diagnostic[] }) {
        for (const file in files) {
            const fileUri = vscode.Uri.file(file);
            if (this.buildErrors.delete(file)) {
                this.diagnosticBuildCollection.delete(fileUri);
            }
            const list = [...(this.diagnosticBuildCollection.get(fileUri) || []), ...files[file]];
            this.diagnosticBuildCollection.set(
                fileUri,
                this.uniqueProblems(list, this.globalProblems(fileUri))
            );
        }
    }

    async parseAsyncLogs(workspacePath: string, filePath: string, showProblemPanelOnError = true) {
        return new Promise<void>((resolve, reject) => {
            if (this.watcherProc !== undefined) {
                this.watcherProc.kill();
            }

            this.buildLogFile = path.join(workspacePath, filePath);
            const options: SpawnOptions = {
                cwd: workspacePath,
                shell: true,
                stdio: "pipe",
            };
            const child = spawn(`tail`, ["-f", `"${filePath}"`], options);

            this.clear();
            let firstIndex = 0;
            let stdout = "";
            let triggerCharacter = "^";
            const decoder = new TextDecoder("utf-8");
            let isError = false;
            let numberOfLines = 0;

            child.stdout?.on("data", async data => {
                stdout += decoder.decode(data);
                let lastErrorIndex = -1;
                for (let i = firstIndex; i < stdout.length; ++i) {
                    if (stdout[i] === triggerCharacter) {
                        lastErrorIndex = i;
                        if (triggerCharacter === "^") {
                            triggerCharacter = "\n";
                            lastErrorIndex = -1;
                        }
                    }
                }

                const shouldEnd = stdout.indexOf("■") !== -1;
                if (shouldEnd) {
                    lastErrorIndex = stdout.length - 1;
                }
                if (lastErrorIndex !== -1) {
                    triggerCharacter = "^";
                    const problems = this.parseBuildLog(
                        stdout.substring(0, lastErrorIndex + 1),
                        numberOfLines
                    );
                    for (const problem in problems) {
                        isError =
                            isError ||
                            problems[problem].filter(e => {
                                return e.severity === vscode.DiagnosticSeverity.Error;
                            }).length > 0;
                    }
                    this.storeProblems(problems);
                    for (let i = 0; i < lastErrorIndex + 1; ++i)
                        numberOfLines += stdout[i] === "\n" ? 1 : 0;
                    stdout = stdout.substring(lastErrorIndex + 1);
                    firstIndex = 0;
                } else {
                    firstIndex = stdout.length;
                }
                if (shouldEnd) {
                    for (const file of this.buildErrors) {
                        this.diagnosticBuildCollection.delete(vscode.Uri.file(file));
                    }
                    this.buildErrors.clear();
                    child.kill();
                }
            });
            child.on("exit", () => {
                if (child === this.watcherProc) {
                    this.watcherProc = undefined;
                    if (showProblemPanelOnError && isError) {
                        vscode.commands.executeCommand("workbench.action.problems.focus");
                        reject();
                    } else {
                        resolve();
                    }
                }
            });
            this.watcherProc = child;
        });
    }

    private problemPattern = /^(.*?):(\d+)(?::(\d+))?:\s+(warning|error|note):\s+(.*)$/gm;
    private problemLinkerPattern = /^(clang):\s+(error):\s+(.*)$/gm;
    private frameworkErrorPattern = /^(error: )(.*?)$/gm;

    private column(output: string, messageEnd: number) {
        let newLineCounter = 0;
        let str = "";
        let shouldBreak = false;
        for (let i = messageEnd; i < output.length; ++i) {
            if (output[i] === "\n") {
                if (shouldBreak) {
                    break;
                }
                str = "";
                newLineCounter += 1;
            } else {
                str += output[i];
            }
            if (output[i] === "^") {
                shouldBreak = true;
            }
            if (newLineCounter >= 3) {
                break;
            }
        }
        let start = str.length,
            end = 0;
        for (let i = 0; i < str.length; ++i) {
            if (str[i] !== " ") {
                start = Math.min(i, start);
                end = Math.max(end, i);
            }
        }
        if (start > end) {
            return [0, 10000];
        }
        return [start, end];
    }

    private parseBuildLog(output: string, numberOfLines: number) {
        const files: { [key: string]: vscode.Diagnostic[] } = {};
        try {
            let matches = [...output.matchAll(this.problemPattern)];
            for (const match of matches) {
                const file = match[1];
                const line = Number(match[2]) - 1;
                const column = this.column(output, (match?.index || 0) + match[0].length);

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
                    default:
                        break;
                }

                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(
                        new vscode.Position(line, column[0]),
                        new vscode.Position(line, column[1])
                    ),
                    message,
                    errorSeverity
                );
                diagnostic.source = "xcodebuild";
                const value = files[file] || [];
                value.push(diagnostic);
                if (fs.existsSync(file)) files[file] = value;
            }
            // parsing linker errors
            matches = [...output.matchAll(this.problemLinkerPattern)];
            for (const match of matches) {
                const file = this.buildLogFile || match[1];

                let line = numberOfLines;
                for (let i = 0; i < (match.index || 0); ++i) {
                    line += output[i] === "\n" ? 1 : 0;
                }

                const message = match[3];
                const errorSeverity = vscode.DiagnosticSeverity.Error;

                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0)),
                    message,
                    errorSeverity
                );
                diagnostic.source = "xcodebuild";
                const value = files[file] || [];
                value.push(diagnostic);
                files[file] = value;
            }
            // parsing framework errors
            matches = [...output.matchAll(this.frameworkErrorPattern)];
            for (const match of matches) {
                const file = this.buildLogFile || "";

                let line = numberOfLines;
                for (let i = 0; i < (match.index || 0); ++i) {
                    line += output[i] === "\n" ? 1 : 0;
                }

                const message = match[2];
                const errorSeverity = vscode.DiagnosticSeverity.Error;

                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0)),
                    message,
                    errorSeverity
                );
                diagnostic.source = "xcodebuild";
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
