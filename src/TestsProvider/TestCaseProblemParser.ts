import { start } from 'repl';
import * as vscode from 'vscode';

const problemPattern = /^(.*?):(\d+)(?::(\d+))?:\s+(warning|error|note):\s+([\s\S]*?)(error|warning|note):?/m;

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
        const problems = this.parseBuildLog(testCase) || [];
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
        this.diagnosticTestsCollection.set(uri, [...existingProblems]);
        this.errors.set(testItem.id, { uri: uri, errors: problems });
    }

    private column(output: string, messageEnd: number) {
        return [0, 10000];
    }

    private parseBuildLog(stdout: string) {
        const files: vscode.Diagnostic[] = [];
        stdout += "\nerror:";
        try {
            let startIndex = 0;
            while (startIndex < stdout.length) {
                while (startIndex > 0) { // find the start of line for the next pattern search
                    if (stdout[startIndex] === '\n')
                        break;
                    --startIndex;
                }

                const output = stdout.slice(startIndex);
                const match = output.match(problemPattern);
                if (!match) return;
                const line = Number(match[2]) - 1;
                const column = this.column(output, (match?.index || 0) + match[0].length);

                const severity = match[4];
                let message = match[5];
                let end = message.lastIndexOf("\n");
                if (end !== -1)
                    message = message.substring(0, end);
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

                startIndex += (match.index || 0) + match[0].length;
            }
        } catch (err) {
            console.log(err);
        }
        return files;
    }
}