import * as assert from "assert";
import { _private } from "../../../src/ProblemDiagnosticResolver";
import * as fs from "fs";
import path from "path";

const cwd = __dirname;
function location(filePath: string) {
    return path.join(
        cwd,
        "..",
        "..",
        "..",
        "..",
        "test",
        "extension",
        "ProblemDiagnostic",
        "mocks",
        filePath
    );
}

suite("Problem Diagnostic Resolver: Parser", () => {
    test("Test 1: Empty", () => {
        const output = fs.readFileSync(location("build_log_empty.txt")).toString();
        const result = _private.parseBuildLog("build.log", output, 0);
        assert.deepStrictEqual(result, {});
    });

    test("Test 2: Success", () => {
        const output = fs.readFileSync(location("build_log_success.txt")).toString();
        const result = _private.parseBuildLog("build.log", output, 0);
        assert.deepStrictEqual(result, {});
    });

    test("Test 3: Errors", () => {
        const output = fs.readFileSync(location("build_log_with_errors.txt")).toString();
        const result = _private.parseBuildLog("build.log", output, 0);
        assert.deepStrictEqual(
            JSON.stringify(result),
            JSON.stringify({
                "/Users/Ievgenii_Mykhalevskyi/tests/Test_ios/Test_ios/ContentView.swift": [
                    {
                        severity: "Error",
                        message: "expected initial value after '='",
                        range: [
                            { line: 57, character: 23 },
                            { line: 57, character: 23 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Error",
                        message: "cannot find 'pprt' in scope",
                        range: [
                            { line: 55, character: 16 },
                            { line: 55, character: 19 },
                        ],
                        source: "xcodebuild",
                    },
                ],
            })
        );
    });

    test("Test 4: Errors", () => {
        const output = fs.readFileSync(location("build_log_with_linker_errors.txt")).toString();
        const result = _private.parseBuildLog("build.log", output, 0);
        assert.deepStrictEqual(
            JSON.stringify(result),
            JSON.stringify({
                "build.log": [
                    {
                        severity: "Error",
                        message: "failed to link. Firebase.framework is not not found",
                        range: [
                            { line: 8, character: 0 },
                            { line: 8, character: 0 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Error",
                        message: "TCA.framework library is not found.",
                        range: [
                            { line: 4, character: 0 },
                            { line: 4, character: 0 },
                        ],
                        source: "xcodebuild",
                    },
                ],
            })
        );
    });

    test("Test 5: Success With Warnings", () => {
        const output = fs.readFileSync(location("build_log_success_with_warnings.txt")).toString();
        const result = _private.parseBuildLog("build.log", output, 0);
        assert.deepStrictEqual(
            JSON.stringify(result),
            JSON.stringify({
                "/Users/Ievgenii_Mykhalevskyi/tests/Test_ios/Test_ios/ContentView.swift": [
                    {
                        severity: "Warning",
                        message: "constant 'a' inferred to have type '()', which may be unexpected",
                        range: [
                            { line: 79, character: 20 },
                            { line: 79, character: 20 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Information",
                        message: "add an explicit type annotation to silence this warning",
                        range: [
                            { line: 79, character: 20 },
                            { line: 79, character: 20 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Warning",
                        message:
                            "initialization of immutable value 'a2' was never used; consider replacing with assignment to '_' or removing it",
                        range: [
                            { line: 57, character: 16 },
                            { line: 57, character: 21 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Warning",
                        message:
                            "initialization of immutable value 'fdgd' was never used; consider replacing with assignment to '_' or removing it",
                        range: [
                            { line: 63, character: 16 },
                            { line: 63, character: 23 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Warning",
                        message:
                            "initialization of immutable value 'comment' was never used; consider replacing with assignment to '_' or removing it",
                        range: [
                            { line: 65, character: 16 },
                            { line: 65, character: 26 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Warning",
                        message:
                            "initialization of immutable value 'a' was never used; consider replacing with assignment to '_' or removing it",
                        range: [
                            { line: 79, character: 16 },
                            { line: 79, character: 20 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Warning",
                        message:
                            "immutable value 'dfs' was never used; consider replacing with '_' or removing it",
                        range: [
                            { line: 86, character: 20 },
                            { line: 86, character: 22 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Warning",
                        message:
                            "initialization of immutable value 'b' was never used; consider replacing with assignment to '_' or removing it",
                        range: [
                            { line: 87, character: 16 },
                            { line: 87, character: 20 },
                        ],
                        source: "xcodebuild",
                    },
                ],
                "/Users/Ievgenii_Mykhalevskyi/tests/Test_ios/Test_iosTests/Test_iosTests.swift": [
                    {
                        severity: "Warning",
                        message: "constant 'a' inferred to have type '()', which may be unexpected",
                        range: [
                            { line: 99, character: 16 },
                            { line: 99, character: 16 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Information",
                        message: "add an explicit type annotation to silence this warning",
                        range: [
                            { line: 99, character: 16 },
                            { line: 99, character: 16 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Information",
                        message:
                            "'#expect(_:_:)' will always pass here; use 'Bool(true)' to silence this warning (from macro 'expect')",
                        range: [
                            { line: 100, character: 20 },
                            { line: 100, character: 23 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Warning",
                        message:
                            "initialization of immutable value 'a' was never used; consider replacing with assignment to '_' or removing it",
                        range: [
                            { line: 99, character: 12 },
                            { line: 99, character: 16 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Information",
                        message:
                            "'#expect(_:_:)' will always pass here; use 'Bool(true)' to silence this warning (from macro 'expect')",
                        range: [
                            { line: 172, character: 12 },
                            { line: 172, character: 15 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Information",
                        message:
                            "'#expect(_:_:)' will always pass here; use 'Bool(true)' to silence this warning (from macro 'expect')",
                        range: [
                            { line: 176, character: 12 },
                            { line: 176, character: 15 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Information",
                        message:
                            "'#expect(_:_:)' will always pass here; use 'Bool(true)' to silence this warning (from macro 'expect')",
                        range: [
                            { line: 181, character: 12 },
                            { line: 181, character: 15 },
                        ],
                        source: "xcodebuild",
                    },
                ],
                "/Users/Ievgenii_Mykhalevskyi/tests/Test_ios/Test_iosTests/Best.swift": [
                    {
                        severity: "Warning",
                        message:
                            "initialization of immutable value 'a' was never used; consider replacing with assignment to '_' or removing it",
                        range: [
                            { line: 5, character: 8 },
                            { line: 5, character: 12 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Warning",
                        message:
                            "initialization of immutable value 'b' was never used; consider replacing with assignment to '_' or removing it",
                        range: [
                            { line: 6, character: 8 },
                            { line: 6, character: 12 },
                        ],
                        source: "xcodebuild",
                    },
                ],
                "/Users/Ievgenii_Mykhalevskyi/tests/Test_ios/Test_iosTests/SecondTests.swift": [
                    {
                        severity: "Warning",
                        message:
                            "initialization of immutable value 'b' was never used; consider replacing with assignment to '_' or removing it",
                        range: [
                            { line: 17, character: 8 },
                            { line: 17, character: 12 },
                        ],
                        source: "xcodebuild",
                    },
                ],
                "/Users/Ievgenii_Mykhalevskyi/tests/Test_ios/Test_iosTests/SomeNewTesting.swift": [
                    {
                        severity: "Information",
                        message:
                            "'#expect(_:_:)' will always pass here; use 'Bool(true)' to silence this warning (from macro 'expect')",
                        range: [
                            { line: 4, character: 16 },
                            { line: 4, character: 19 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Warning",
                        message:
                            "initialization of immutable value 'a' was never used; consider replacing with assignment to '_' or removing it",
                        range: [
                            { line: 12, character: 8 },
                            { line: 12, character: 12 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Warning",
                        message:
                            "initialization of immutable value 'b' was never used; consider replacing with assignment to '_' or removing it",
                        range: [
                            { line: 16, character: 8 },
                            { line: 16, character: 12 },
                        ],
                        source: "xcodebuild",
                    },
                ],
            })
        );
    });
});
