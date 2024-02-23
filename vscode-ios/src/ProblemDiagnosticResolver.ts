import { start } from 'repl';
import * as vscode from 'vscode';

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
        tokens[2] = tokens[2].slice( matchStart?.index);
        matchStart = tokens[2].match(start);

        tokens[2] = "_".repeat(matchStart?.index || 0) + tokens[2].slice(matchStart?.index || 0);
        return tokens.join("\n");
    }

    parseBuildLog(output: string, type: ProblemDiagnosticLogType) {
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
                const message = type === ProblemDiagnosticLogType.build ? this.transformBuildMessage(match[5]) : match[5];
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
                diagnostic.source = type === ProblemDiagnosticLogType.build ? "xcodebuild": "xcodebuild-tests";
                const value = files[file] || [];
                value.push(diagnostic);
                files[file] = value;
            }

            for (let file in files) {
                switch (type) {
                    case ProblemDiagnosticLogType.build:
                        this.diagnosticBuildCollection.set(vscode.Uri.file(file), files[file]);
                        break;
                    case ProblemDiagnosticLogType.tests:
                        this.diagnosticTestsCollection.set(vscode.Uri.file(file), files[file]);
                        break;
                }
            }
        } catch (err) {
            console.log(err);
        }
    }
}