import { getLSPWorkspacePath } from "../env";
import { HandleProblemDiagnosticResolver } from "./lspExtension";
import * as vscode from "vscode";

export interface WorkspaceContext {
    readonly workspaceFolder: vscode.Uri;
    readonly problemDiagnosticResolver: HandleProblemDiagnosticResolver;
}

export class WorkspaceContextImp implements WorkspaceContext {
    readonly workspaceFolder: vscode.Uri;
    readonly problemDiagnosticResolver: HandleProblemDiagnosticResolver;
    constructor(problemDiagnosticResolver: HandleProblemDiagnosticResolver) {
        this.workspaceFolder = getLSPWorkspacePath();
        this.problemDiagnosticResolver = problemDiagnosticResolver;
    }
}
