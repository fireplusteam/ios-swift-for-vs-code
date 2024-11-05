import * as fs from "fs";
import * as vscode from "vscode";
import { HandleProblemDiagnosticResolver, SourcePredicate } from "./LSP/lspExtension";
import { getFilePathInWorkspace } from "./env";

export class RawBuildParser {
    firstIndex = 0;
    triggerCharacter = "^";
    isError = false;
    numberOfLines = 0;
    stdout = "";
    buildLogFile: string;
    watcherDisposal?: vscode.Disposable;

    constructor(buildLogFile: string) {
        this.buildLogFile = buildLogFile;
    }
}

export class ProblemDiagnosticResolver implements HandleProblemDiagnosticResolver {
    private static xcodebuild = "xcodebuild";
    static isSourcekit: SourcePredicate = source => this.xcodebuild !== source;
    static isXcodebuild: SourcePredicate = source => this.xcodebuild === source;

    private disposable: vscode.Disposable[] = [];
    private diagnosticBuildCollection: vscode.DiagnosticCollection;

    private buildErrors = new Set<string>();

    constructor() {
        this.diagnosticBuildCollection = vscode.languages.createDiagnosticCollection("Xcode");

        this.disposable.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                const fileUrl = e.document.uri;
                if (fileUrl === undefined) {
                    return;
                }
                if (fileUrl.fsPath.endsWith(".log")) {
                    return;
                }
                const notBuildProblems =
                    this.diagnosticBuildCollection
                        .get(fileUrl)
                        ?.filter(e => !ProblemDiagnosticResolver.isXcodebuild(e.source || "")) ||
                    [];
                this.diagnosticBuildCollection.set(fileUrl, notBuildProblems);
            })
        );
        this.disposable.push(
            vscode.workspace.onDidCloseTextDocument(doc => {
                const fileUrl = doc.uri;
                const notSourceKitProblems =
                    this.diagnosticBuildCollection
                        .get(fileUrl)
                        ?.filter(e => !ProblemDiagnosticResolver.isSourcekit(e.source || "")) || [];
                // on close clean source kit issues
                this.diagnosticBuildCollection.set(fileUrl, notSourceKitProblems);
            })
        );
    }

    public handleDiagnostics(
        uri: vscode.Uri,
        isSourceKit: SourcePredicate,
        newDiagnostics: vscode.Diagnostic[]
    ): void {
        console.log(uri, isSourceKit(""), newDiagnostics);
        this.diagnosticBuildCollection.set(uri, newDiagnostics);
    }

    private clear() {
        this.buildErrors.clear();
        this.diagnosticBuildCollection.forEach((uri, diagnostics) => {
            const newDiagnostics = diagnostics.filter(e =>
                ProblemDiagnosticResolver.isXcodebuild(e.source || "")
            );
            if (newDiagnostics.length > 0) {
                this.buildErrors.add(uri.fsPath);
            }
        });
    }

    private uniqueProblems(list: vscode.Diagnostic[], sourcekitList: vscode.Diagnostic[]) {
        function compareRanges(range1: vscode.Range, range2: vscode.Range): number {
            if (range1.start.line !== range2.start.line) {
                return range1.start.line - range2.start.line;
            }
            if (range1.start.character !== range2.start.character) {
                return range1.start.character - range2.start.character;
            }
            if (range1.end.line !== range2.end.line) {
                return range1.end.line - range2.end.line;
            }
            if (range1.end.character !== range2.end.character) {
                return range1.end.character - range2.end.character;
            }
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
                                if (a.start.line !== b.start.line) {
                                    return a.start.line - b.start.line;
                                }
                                if (a.end.line !== b.end.line) {
                                    return a.end.line - b.end.line;
                                }
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

    private storeProblems(files: { [key: string]: vscode.Diagnostic[] }) {
        for (const file in files) {
            const fileUri = vscode.Uri.file(file);
            let shouldDelete = false;
            if (this.buildErrors.delete(file)) {
                shouldDelete = true;
            }
            const allOthers =
                this.diagnosticBuildCollection
                    .get(fileUri)
                    ?.filter(e => !ProblemDiagnosticResolver.isXcodebuild(e.source || "")) || [];
            const list = [
                ...(shouldDelete === true
                    ? []
                    : this.diagnosticBuildCollection
                          .get(fileUri)
                          ?.filter(e => ProblemDiagnosticResolver.isXcodebuild(e.source || "")) ||
                      []),
                ...files[file],
            ];
            this.diagnosticBuildCollection.set(fileUri, [
                ...this.uniqueProblems(list, allOthers),
                ...allOthers,
            ]);
        }
    }

    public parseAsyncLogs(filePath: string, buildPipeEvent: vscode.Event<string>) {
        const buildLogFile = getFilePathInWorkspace(filePath);

        this.clear();
        const rawParser = new RawBuildParser(buildLogFile);
        rawParser.watcherDisposal = buildPipeEvent(data => {
            rawParser.stdout += data;
            this.parseStdout(rawParser, false);
        });
        return rawParser;
    }

    public end(rawParser: RawBuildParser, showProblemPanelOnError = true) {
        rawParser.watcherDisposal?.dispose();
        rawParser.watcherDisposal = undefined;
        this.parseStdout(rawParser, true);
        if (showProblemPanelOnError && rawParser.isError) {
            vscode.commands.executeCommand("workbench.action.problems.focus");
        }
    }

    private parseStdout(rawParser: RawBuildParser, shouldEnd: boolean) {
        let lastErrorIndex = -1;
        for (let i = rawParser.firstIndex; i < rawParser.stdout.length; ++i) {
            if (rawParser.stdout[i] === rawParser.triggerCharacter) {
                lastErrorIndex = i;
                if (rawParser.triggerCharacter === "^") {
                    rawParser.triggerCharacter = "\n";
                    lastErrorIndex = -1;
                }
            }
        }

        if (shouldEnd) {
            lastErrorIndex = rawParser.stdout.length - 1;
        }
        if (lastErrorIndex !== -1) {
            rawParser.triggerCharacter = "^";
            const problems = this.parseBuildLog(
                rawParser.buildLogFile,
                rawParser.stdout.substring(0, lastErrorIndex + 1),
                rawParser.numberOfLines
            );
            for (const problem in problems) {
                rawParser.isError =
                    rawParser.isError ||
                    problems[problem].filter(e => {
                        return e.severity === vscode.DiagnosticSeverity.Error;
                    }).length > 0;
            }
            this.storeProblems(problems);
            for (let i = 0; i < lastErrorIndex + 1; ++i) {
                rawParser.numberOfLines += rawParser.stdout[i] === "\n" ? 1 : 0;
            }
            rawParser.stdout = rawParser.stdout.substring(lastErrorIndex + 1);
            rawParser.firstIndex = 0;
        } else {
            rawParser.firstIndex = rawParser.stdout.length;
        }
        if (shouldEnd) {
            for (const file of this.buildErrors) {
                const newDiagnostics =
                    this.diagnosticBuildCollection
                        .get(vscode.Uri.file(file))
                        ?.filter(e => !ProblemDiagnosticResolver.isXcodebuild(e.source || "")) ||
                    [];
                this.diagnosticBuildCollection.set(vscode.Uri.file(file), newDiagnostics);
            }
            this.buildErrors.clear();
        }
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

    private parseBuildLog(buildLogFile: string, output: string, numberOfLines: number) {
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
                diagnostic.source = ProblemDiagnosticResolver.xcodebuild;
                const value = files[file] || [];
                value.push(diagnostic);
                if (fs.existsSync(file)) {
                    files[file] = value;
                }
            }
            // parsing linker errors
            matches = [...output.matchAll(this.problemLinkerPattern)];
            for (const match of matches) {
                const file = buildLogFile;

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
                diagnostic.source = ProblemDiagnosticResolver.xcodebuild;
                const value = files[file] || [];
                value.push(diagnostic);
                files[file] = value;
            }
            // parsing framework errors
            matches = [...output.matchAll(this.frameworkErrorPattern)];
            for (const match of matches) {
                const file = buildLogFile;

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
                diagnostic.source = ProblemDiagnosticResolver.xcodebuild;
                const value = files[file] || [];
                value.push(diagnostic);
                files[file] = value;
            }
        } catch (err) {
            console.log(`Error parsing build logs: ${err}`);
        }
        return files;
    }
}
