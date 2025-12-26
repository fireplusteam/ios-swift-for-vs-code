import * as fs from "fs";
import * as vscode from "vscode";
import { HandleProblemDiagnosticResolver, SourcePredicate } from "./LSP/lspExtension";
import { getFilePathInWorkspace } from "./env";
import { Executor } from "./Executor";
import { BundlePath } from "./CommandManagement/BundlePath";

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
    static xcodebuild = "xcodebuild";
    static isSourcekit: SourcePredicate = source => ProblemDiagnosticResolver.xcodebuild !== source;
    static isXcodebuild: SourcePredicate = source =>
        ProblemDiagnosticResolver.xcodebuild === source;

    private disposable: vscode.Disposable[] = [];
    private diagnosticBuildCollection: vscode.DiagnosticCollection;

    private filesWithPreviousBuildDiagnostics = new Set<string>();
    private log: vscode.OutputChannel;

    constructor(log: vscode.OutputChannel) {
        this.log = log;
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
                    this.diagnosticBuildCollection.get(fileUrl)?.filter(
                        e =>
                            !ProblemDiagnosticResolver.isXcodebuild(e.source || "") ||
                            this.isDiagnosticFromSwiftMacroError(e) // keep swift macro errors, as they are not handled by source kit
                    ) || [];
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
        this.disposable.push(
            vscode.workspace.onDidDeleteFiles(e => {
                for (const file of e.files) {
                    this.diagnosticBuildCollection.delete(file);
                }
            })
        );
    }

    public handleDiagnostics(
        uri: vscode.Uri,
        isSourceKit: SourcePredicate,
        newDiagnostics: vscode.Diagnostic[]
    ): void {
        // console.log(uri, isSourceKit(""), newDiagnostics);
        const filesWithNewBuildDiagnostics: { [key: string]: vscode.Diagnostic[] } = {};
        filesWithNewBuildDiagnostics[uri.fsPath] = newDiagnostics;
        const previousBuildDiagnostics = new Set<string>();
        previousBuildDiagnostics.add(uri.fsPath);
        this.storeNewDiagnostics(
            filesWithNewBuildDiagnostics,
            previousBuildDiagnostics,
            ProblemDiagnosticResolver.isSourcekit
        );
    }

    private refreshPreviousBuildDiagnostics() {
        this.filesWithPreviousBuildDiagnostics.clear();
        this.diagnosticBuildCollection.forEach((uri, diagnostics) => {
            const newDiagnostics = diagnostics.filter(e =>
                ProblemDiagnosticResolver.isXcodebuild(e.source || "")
            );
            if (newDiagnostics.length > 0) {
                this.filesWithPreviousBuildDiagnostics.add(uri.fsPath);
            }
        });
    }

    private uniqueDiagnostics(
        itemsToAdd: vscode.Diagnostic[],
        existingItemsList: vscode.Diagnostic[]
    ) {
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

        function compareDiagnostics(
            a: vscode.Diagnostic,
            b: vscode.Diagnostic,
            compRanges: (a: vscode.Range, b: vscode.Range) => number = compareRanges
        ) {
            if (a.message.trim().toLowerCase() !== b.message.trim().toLowerCase()) {
                return a.message.trim().toLowerCase() < b.message.trim().toLowerCase() ? -1 : 1;
            }
            if (a.severity !== b.severity) {
                return a.severity - b.severity;
            }
            if (a.range.isEqual(b.range) === false) {
                return compRanges(a.range, b.range);
            }
            return 0;
        }
        itemsToAdd.sort(compareDiagnostics);
        const res: vscode.Diagnostic[] = [];
        for (let i = 0; i < itemsToAdd.length; ++i) {
            if (res.length === 0 || compareDiagnostics(itemsToAdd[i], res[res.length - 1]) !== 0) {
                if (
                    existingItemsList.find(v => {
                        return (
                            compareDiagnostics(v, itemsToAdd[i], (a, b) => {
                                // enough to compare only start line for existing items as the end line is likely different but if message/severity and start line are same then it's duplicate
                                if (a.start.line !== b.start.line) {
                                    return a.start.line - b.start.line;
                                }
                                return 0;
                            }) === 0
                        );
                    }) === undefined
                ) {
                    res.push(itemsToAdd[i]);
                }
            }
        }
        return res;
    }

    private storeNewDiagnostics(
        filesWithNewBuildDiagnostics: { [key: string]: vscode.Diagnostic[] },
        filesWithPreviousBuildDiagnostics: Set<string>,
        sourcePredicate: SourcePredicate
    ) {
        for (const file in filesWithNewBuildDiagnostics) {
            const fileUri = vscode.Uri.file(file);
            let shouldDelete = false;
            if (filesWithPreviousBuildDiagnostics.delete(file)) {
                shouldDelete = true;
            }
            const allOthers =
                this.diagnosticBuildCollection
                    .get(fileUri)
                    ?.filter(e => !sourcePredicate(e.source || "")) || [];
            const toAddItems = [
                ...(shouldDelete === true
                    ? []
                    : this.diagnosticBuildCollection
                          .get(fileUri)
                          ?.filter(e => sourcePredicate(e.source || "")) || []),
                ...filesWithNewBuildDiagnostics[file],
            ];
            // console.log(
            //     `Storing problems for file: ${file}, to add: ${JSON.stringify(toAddItems)}, all others: ${JSON.stringify(allOthers)}`
            // );
            this.diagnosticBuildCollection.set(fileUri, [
                ...this.uniqueDiagnostics(toAddItems, allOthers),
                ...allOthers,
            ]);
        }
    }

    public parseAsyncLogs(filePath: string, buildPipeEvent: vscode.Event<string>) {
        const buildLogFile = getFilePathInWorkspace(filePath);

        this.refreshPreviousBuildDiagnostics();
        const rawParser = new RawBuildParser(buildLogFile);
        rawParser.watcherDisposal = buildPipeEvent(data => {
            rawParser.stdout += data;
            this.parseStdout(rawParser, false);
        });
        return rawParser;
    }

    public async end(
        bundle: BundlePath,
        rawParser: RawBuildParser,
        showProblemPanelOnError = true,
        cleanupPreviousBuildErrors = true
    ) {
        rawParser.watcherDisposal?.dispose();
        rawParser.watcherDisposal = undefined;
        this.parseStdout(rawParser, true);

        try {
            await this.enumerateBuildResults(bundle);
        } catch (err) {
            this.log.appendLine(`Error enumerating build results: ${err}`);
        }

        if (cleanupPreviousBuildErrors) {
            for (const file of this.filesWithPreviousBuildDiagnostics) {
                const newDiagnostics =
                    this.diagnosticBuildCollection
                        .get(vscode.Uri.file(file))
                        ?.filter(e => !ProblemDiagnosticResolver.isXcodebuild(e.source || "")) ||
                    [];
                this.diagnosticBuildCollection.set(vscode.Uri.file(file), newDiagnostics);
            }
        }
        this.filesWithPreviousBuildDiagnostics.clear();

        if (showProblemPanelOnError && rawParser.isError) {
            vscode.commands.executeCommand("workbench.action.problems.focus");
        }
    }

    private xcBundlePath(bundle: BundlePath) {
        return getFilePathInWorkspace(bundle.bundlePath());
    }

    private async enumerateBuildResults(bundle: BundlePath) {
        // reference: https://keith.github.io/xcode-man-pages/xcresulttool.1.html#get
        const command = `xcrun xcresulttool get build-results --path '${this.xcBundlePath(bundle)}' --format json`;
        const executor = new Executor();
        const outFileCoverageStr = await executor.execShell({
            scriptOrCommand: { command: command },
        });
        // this.log.appendLine(`Build logs => outFileCoverageStr: ${outFileCoverageStr.stdout}`);
        const buildingDiagnosticErrors = parseSwiftMacrosInXcodeBuildLogs(
            outFileCoverageStr.stdout,
            path => {
                return fs.readFileSync(path, "utf8");
            },
            this.log
        );
        this.storeNewDiagnostics(
            buildingDiagnosticErrors,
            this.filesWithPreviousBuildDiagnostics,
            ProblemDiagnosticResolver.isXcodebuild
        );
    }

    private isDiagnosticFromSwiftMacroError(diagnostic: vscode.Diagnostic): boolean {
        return diagnostic.message.startsWith("Swift Macro Error:");
    }

    private parseStdout(rawParser: RawBuildParser, shouldEnd: boolean, existsSync = fs.existsSync) {
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
            const problems = parseBuildLog(
                rawParser.buildLogFile,
                rawParser.stdout.substring(0, lastErrorIndex + 1),
                rawParser.numberOfLines,
                this.log,
                existsSync
            );
            for (const problem in problems) {
                rawParser.isError =
                    rawParser.isError ||
                    problems[problem].filter(e => {
                        return e.severity === vscode.DiagnosticSeverity.Error;
                    }).length > 0;
            }
            this.storeNewDiagnostics(
                problems,
                this.filesWithPreviousBuildDiagnostics,
                ProblemDiagnosticResolver.isXcodebuild
            );
            for (let i = 0; i < lastErrorIndex + 1; ++i) {
                rawParser.numberOfLines += rawParser.stdout[i] === "\n" ? 1 : 0;
            }
            rawParser.stdout = rawParser.stdout.substring(lastErrorIndex + 1);
            rawParser.firstIndex = 0;
        } else {
            rawParser.firstIndex = rawParser.stdout.length;
        }
    }
}

const problemPattern = /^(.*?):(\d+)(?::(\d+))?:\s+(warning|error|note):\s+(.*)$/gm;
const problemLinkerPattern = /^(clang):\s+(error):\s+(.*)$/gm;
const frameworkErrorPattern = /^(error: )(.*?)$/gm;

function parseSwiftMacrosInXcodeBuildLogs(
    buildLogs: string,
    readFileSync: (path: string) => string,
    log: vscode.OutputChannel
) {
    const json = JSON.parse(buildLogs);
    const errors = json["errors"] || [];

    const files: { [key: string]: vscode.Diagnostic[] } = {};

    for (const error of errors) {
        const message = error["message"] || "";
        let sourceURL: string = error["sourceURL"] || "";
        // Example: file:///var/folders/cf/szyj4d9j2j5dkh0ctxhh_djc0000gn/T/swift-generated-sources/@__swiftmacro_20CNF07ProfileB0V47ReducerfMe_.swift#EndingColumnNumber=57&EndingLineNumber=0&StartingColumnNumber=57&StartingLineNumber=0&Timestamp=786622174.129034
        sourceURL = sourceURL.replace("file:///", "/private/").replace(/#.*$/, "");
        if (sourceURL.includes("@__swiftmacro_")) {
            try {
                const content = readFileSync(sourceURL);
                /// Example content:
                // Some swift Code here
                //
                //  original-source-range: /Users/Ievgenii_Mykhalevskyi/repos/source1/Sources/UI/Scenes/Test.swift:259:2-259:2
                const originalSourceRangePattern =
                    /original-source-range:\s(.*?):(\d+):(\d+)-(\d+):(\d+)/gm;
                const matches = [...content.matchAll(originalSourceRangePattern)];
                for (const match of matches) {
                    const file = match[1];
                    const startLine = Number(match[2]) - 1;
                    const startColumn = Number(match[3]) - 1;
                    const endLine = Number(match[4]) - 1;
                    const endColumn = Number(match[5]) - 1;
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(
                            new vscode.Position(startLine, startColumn),
                            new vscode.Position(endLine, endColumn)
                        ),
                        `Swift Macro Error: ${message}\n\nMACRO ERROR:\n${content}`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = ProblemDiagnosticResolver.xcodebuild;
                    const value = files[file] || [];
                    value.push(diagnostic);
                    files[file] = value;
                }
            } catch (err) {
                const file = sourceURL;
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
                    message,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.source = ProblemDiagnosticResolver.xcodebuild;
                const value = files[file] || [];
                value.push(diagnostic);
                files[file] = value;
                log.appendLine(`Error reading or parsing macro source file: ${err}`);
            }
        }
    }
    return files;
}

function column(output: string, messageEnd: number) {
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

function parseBuildLog(
    buildLogFile: string,
    output: string,
    numberOfLines: number,
    log: vscode.OutputChannel,
    existsSync = fs.existsSync
) {
    const files: { [key: string]: vscode.Diagnostic[] } = {};
    try {
        let matches = [...output.matchAll(problemPattern)];
        for (const match of matches) {
            const file = match[1];
            const line = Number(match[2]) - 1;
            const localColumn = column(output, (match?.index || 0) + match[0].length);

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
                    new vscode.Position(line, localColumn[0]),
                    new vscode.Position(line, localColumn[1])
                ),
                message,
                errorSeverity
            );
            diagnostic.source = ProblemDiagnosticResolver.xcodebuild;
            const value = files[file] || [];
            value.push(diagnostic);
            if (existsSync(file)) {
                files[file] = value;
            }
        }
        // parsing linker errors
        matches = [...output.matchAll(problemLinkerPattern)];
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
        matches = [...output.matchAll(frameworkErrorPattern)];
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
        log.appendLine(`Error parsing xcodebuild build logs: ${err}`);
    }
    return files;
}

export const _private = {
    parseBuildLog,
    parseSwiftMacrosInXcodeBuildLogs,
};
