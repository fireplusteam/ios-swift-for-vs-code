import { HandleProblemDiagnosticResolver } from "../ProblemDiagnosticResolver";

export interface WorkspaceContext {
    problemDiagnosticResolver: HandleProblemDiagnosticResolver;
}

export class WorkspaceContextImp implements WorkspaceContext {
    problemDiagnosticResolver: HandleProblemDiagnosticResolver;
    constructor(problemDiagnosticResolver: HandleProblemDiagnosticResolver) {
        this.problemDiagnosticResolver = problemDiagnosticResolver;
    }
}
