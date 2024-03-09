import { ChildProcess, SpawnOptions, spawn } from 'child_process';
import * as vscode from 'vscode';

const problemPattern = /^(.*?):(\d+)(?::(\d+))?:\s+(warning|error|note):\s+(.*)$/gm;

export class TestCaseProblemParser {

    disposable: vscode.Disposable[] = [];
    diagnosticTestsCollection: vscode.DiagnosticCollection;

    errors = new Map<string, { uri: vscode.Uri, errors: vscode.Diagnostic[] }>();

    constructor() {
        this.diagnosticTestsCollection = vscode.languages.createDiagnosticCollection("xcodebuild-tests");
    }

    async checkExistingTestCases(testItems: vscode.TestItem[]) {
        const itemsMap = new Set<string>(testItems.map(e => { return e.id; }));

        const toDelete = [] as string[];
        for (const [id,] of this.errors) {
            if (!itemsMap.has(id)) {
                toDelete.push(id);
            }
        }
        for (const itemToDelete of toDelete) {
            this.delete(itemToDelete);
        }
    }

    private delete(id: string) {
        const uri = this.errors.get(id)?.uri || vscode.Uri.file("");
        const existingProblems = new Set<vscode.Diagnostic>(this.diagnosticTestsCollection.get(uri));
        for (const problem of this.errors.get(id)?.errors || []) {
            existingProblems.delete(problem);
        }
        this.diagnosticTestsCollection.set(uri, [...existingProblems]);
        this.errors.delete(id);
    }

    async parseAsyncLogs(testCase: string, testItem: vscode.TestItem) {
        const problems = this.parseBuildLog(testCase);
        const uri = testItem.uri;
        const id = testItem.id;
        if (!uri)
            return;
        const existingProblems = new Set<vscode.Diagnostic>(this.diagnosticTestsCollection.get(uri));
        for (const problem of this.errors.get(id)?.errors || []) {
            existingProblems.delete(problem);
        }
        this.errors.delete(id);
        problems.forEach(problem => {
            existingProblems.add(problem);
        });
        this.diagnosticTestsCollection.set(uri,[...existingProblems]);
        this.errors.set(testItem.id, { uri: uri, errors: problems });
    }

    private column(output: string, messageEnd: number) {
        return [0, 10000];
    }

    private parseBuildLog(output: string) {
        const files: vscode.Diagnostic[] = [];
        try {
            let matches = [...output.matchAll(problemPattern)];
            for (const match of matches) {
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
                    default: break;
                }

                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(
                        new vscode.Position(line, column[0]),
                        new vscode.Position(line, column[1])),
                    message,
                    errorSeverity
                );
                diagnostic.source = "xcodebuild-tests";
                files.push(diagnostic);
            }
        } catch (err) {
            console.log(err);
        }
        return files;
    }
}