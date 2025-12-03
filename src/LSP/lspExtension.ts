import * as vscode from "vscode";

// Test styles where test-target represents a test target that contains tests
export type TestStyle = "XCTest" | "swift-testing" | "test-target";

export interface LSPClientContext {
    start: () => void;
    restart: () => void;
}

export type SourcePredicate = (source: string) => boolean;

export interface HandleProblemDiagnosticResolver {
    handleDiagnostics: (
        uri: vscode.Uri,
        isSourceKit: SourcePredicate,
        newDiagnostics: vscode.Diagnostic[]
    ) => void;
}

// Definitions for non-standard requests used by sourcekit-lsp

/** Language client errors */
export const enum LanguageClientError {
    LanguageClientUnavailable = "Language Client Unavailable",
}

export function getTestIDComponents(id: string) {
    const dotIndex = id.indexOf(".");
    let target = "";
    if (dotIndex !== -1) {
        target = id.substring(0, dotIndex);
        id = id.substring(dotIndex + 1);
    }
    const components = id.split("/");
    const suite = components.length <= 1 ? undefined : components.slice(0, -1).join("/");
    const testName = components.at(-1);
    return { target: target, suite: suite, testName: testName };
}

export function languageId(file: string) {
    if (file.endsWith(".swift")) {
        return "swift";
    }
    if (file.endsWith(".m")) {
        return "objective-c";
    }
    if (file.endsWith(".mm")) {
        return "objective-cpp";
    }
}
