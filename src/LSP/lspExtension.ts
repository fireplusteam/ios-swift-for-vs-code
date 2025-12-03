import * as langclient from "vscode-languageclient/node";
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

// Peek Documents
export interface PeekDocumentsParams {
    /**
     * The `DocumentUri` of the text document in which to show the "peeked" editor
     */
    uri: langclient.DocumentUri;

    /**
     * The `Position` in the given text document in which to show the "peeked editor"
     */
    position: vscode.Position;

    /**
     * An array `DocumentUri` of the documents to appear inside the "peeked" editor
     */
    locations: langclient.DocumentUri[];
}

/**
 * Response to indicate the `success` of the `PeekDocumentsRequest`
 */
export interface PeekDocumentsResult {
    success: boolean;
}

/**
 * Request from the server to the client to show the given documents in a "peeked" editor.
 *
 * This request is handled by the client to show the given documents in a "peeked" editor (i.e. inline with / inside the editor canvas).
 *
 * It requires the experimental client capability `"workspace/peekDocuments"` to use.
 */
export const PeekDocumentsRequest = new langclient.RequestType<
    PeekDocumentsParams,
    PeekDocumentsResult,
    unknown
>("workspace/peekDocuments");

/**
 * Response containing `content` of `GetReferenceDocumentRequest`
 */
export interface GetReferenceDocumentResult {
    content: string;
}

/** Language client errors */
export enum LanguageClientError {
    LanguageClientUnavailable,
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
