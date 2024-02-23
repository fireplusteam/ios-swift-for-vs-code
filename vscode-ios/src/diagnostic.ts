import * as vscode from 'vscode';

export class ProblemDiagnosticResolver {

    disposable: vscode.Disposable[] = [];
    diagnosticCollection: vscode.DiagnosticCollection;
    
    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection("xcodebuild");

        this.disposable.push(vscode.workspace.onDidOpenTextDocument((e) => {
            const fileUrl = vscode.window.activeTextEditor?.document.uri;
            if (fileUrl === undefined) { return; }
            let diagnostics = vscode.languages.getDiagnostics(fileUrl);
            for (let di of diagnostics) {
                if (di.source === "xcodebuild") {
                    
                }
            }
            vscode.languages.remove
        }));

    }



}