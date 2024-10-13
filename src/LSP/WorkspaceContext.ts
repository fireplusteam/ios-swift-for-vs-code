import { getLSPWorkspacePath } from "../env";
import { HandleProblemDiagnosticResolver } from "./lspExtension";
import * as vscode from "vscode";

export interface WorkspaceContext {
    readonly workspaceFolder: Promise<vscode.Uri>;
    readonly problemDiagnosticResolver: HandleProblemDiagnosticResolver;
}

export class WorkspaceContextImp implements WorkspaceContext {
    get workspaceFolder(): Promise<vscode.Uri> {
        return getLSPWorkspacePath();
    }
    readonly problemDiagnosticResolver: HandleProblemDiagnosticResolver;
    constructor(problemDiagnosticResolver: HandleProblemDiagnosticResolver) {
        this.problemDiagnosticResolver = problemDiagnosticResolver;
    }
}
