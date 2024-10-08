import * as ls from "vscode-languageserver-protocol";
import * as langclient from "vscode-languageclient/node";

// Test styles where test-target represents a test target that contains tests
export type TestStyle = "XCTest" | "swift-testing" | "test-target";

export interface LSPTestItem {
    /**
     * This identifier uniquely identifies the test case or test suite. It can be used to run an individual test (suite).
     */
    id: string;

    /**
     * Display name describing the test.
     */
    label: string;

    /**
     * Optional description that appears next to the label.
     */
    description?: string;

    /**
     * A string that should be used when comparing this item with other items.
     *
     * When `undefined` the `label` is used.
     */
    sortText?: string;

    /**
     *  Whether the test is disabled.
     */
    disabled: boolean;

    /**
     * The type of test, eg. the testing framework that was used to declare the test.
     */
    style: TestStyle;

    /**
     * The location of the test item in the source code.
     */
    location: ls.Location;

    /**
     * The children of this test item.
     *
     * For a test suite, this may contain the individual test cases or nested suites.
     */
    children: LSPTestItem[];

    /**
     * Tags associated with this test item.
     */
    tags: { id: string }[];
}

interface DocumentTestsParams {
    textDocument: {
        uri: ls.URI;
    };
}

export const textDocumentTestsRequest = new langclient.RequestType<
    DocumentTestsParams,
    LSPTestItem[],
    unknown
>("textDocument/tests");

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
