import * as assert from "assert";
import { _private } from "../../../src/ProblemDiagnosticResolver";
import * as fs from "fs";
import * as path from "path";

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
        const result = _private.parseBuildLog("build.log", output, 0, () => true);
        assert.deepStrictEqual(result, {});
    });

    test("Test 2: Success", () => {
        const output = fs.readFileSync(location("build_log_success.txt")).toString();
        const result = _private.parseBuildLog("build.log", output, 0, () => true);
        assert.deepStrictEqual(result, {});
    });

    test("Test 3: Errors", () => {
        const output = fs.readFileSync(location("build_log_with_errors.txt")).toString();
        const result = _private.parseBuildLog("build.log", output, 0, () => true);
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
        const result = _private.parseBuildLog("build.log", output, 0, () => true);
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

    test("Test 5: Macro Errors", () => {
        const output = fs.readFileSync(location("build_log_with_macro_errors.txt")).toString();
        const result = _private.parseBuildLog("build.log", output, 0, () => true);
        assert.deepStrictEqual(
            JSON.stringify(result),
            JSON.stringify({
                "@__swiftmacro_20Completion07ProfileB0V4Core7ReducerfMe_.swift": [
                    {
                        severity: "Error",
                        message:
                            "conformance of 'ProfileCompletion.Core' to protocol 'Reducer' crosses into main actor-isolated code and can cause data races",
                        range: [
                            { line: 0, character: 57 },
                            { line: 0, character: 57 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Information",
                        message: "isolate this conformance to the main actor with '@MainActor'",
                        range: [
                            { line: 0, character: 57 },
                            { line: 0, character: 57 },
                        ],
                        source: "xcodebuild",
                    },
                    {
                        severity: "Information",
                        message: "turn data races into runtime errors with '@preconcurrency'",
                        range: [
                            { line: 0, character: 57 },
                            { line: 0, character: 57 },
                        ],
                        source: "xcodebuild",
                    },
                ],
                "/Users/Ievgenii_Mykhalevskyi/repos/source1/Experiences/Completion/Sources/UI/Scenes/Composition/ProfileCompletionReducer.swift":
                    [
                        {
                            severity: "Information",
                            message: "in expansion of macro 'Reducer' on struct 'Core' here",
                            range: [
                                { line: 9, character: 4 },
                                { line: 9, character: 11 },
                            ],
                            source: "xcodebuild",
                        },
                        {
                            severity: "Information",
                            message: "in expansion of macro 'Reducer' on struct 'Core' here",
                            range: [
                                { line: 9, character: 4 },
                                { line: 9, character: 11 },
                            ],
                            source: "xcodebuild",
                        },
                        {
                            severity: "Information",
                            message: "in expansion of macro 'Reducer' on struct 'Core' here",
                            range: [
                                { line: 9, character: 4 },
                                { line: 9, character: 11 },
                            ],
                            source: "xcodebuild",
                        },
                        {
                            severity: "Information",
                            message: "in expansion of macro 'Reducer' on struct 'Core' here",
                            range: [
                                { line: 9, character: 4 },
                                { line: 9, character: 11 },
                            ],
                            source: "xcodebuild",
                        },
                        {
                            severity: "Information",
                            message: "in expansion of macro 'Reducer' on struct 'Core' here",
                            range: [
                                { line: 9, character: 4 },
                                { line: 9, character: 11 },
                            ],
                            source: "xcodebuild",
                        },
                        {
                            severity: "Information",
                            message: "in expansion of macro 'Reducer' on struct 'Core' here",
                            range: [
                                { line: 9, character: 4 },
                                { line: 9, character: 11 },
                            ],
                            source: "xcodebuild",
                        },
                        {
                            severity: "Information",
                            message:
                                "main actor-isolated instance method 'reduce(into:action:)' cannot satisfy nonisolated requirement",
                            range: [
                                { line: 17, character: 13 },
                                { line: 17, character: 13 },
                            ],
                            source: "xcodebuild",
                        },
                    ],
            })
        );
    });

    test("Test 6: Success With Warnings", () => {
        const output = fs.readFileSync(location("build_log_success_with_warnings.txt")).toString();
        const result = _private.parseBuildLog("build.log", output, 0, () => true);
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

suite("Problem Diagnostic Xcode build Output Parser Logic Tests", async () => {
    test("Test: isFilePathLine", () => {
        const buildLogInput = fs.readFileSync(location("xcodebuild_building_result.json"), "utf-8");
        const problems = _private.parseSwiftMacrosInXcodeBuildLogs(buildLogInput, filepath => {
            assert.strictEqual(
                filepath,
                "/private/var/folders/cf/szyj4d9j2j5dkh0ctxhh_djc0000gn/T/swift-generated-sources/@__swiftmacro_3PLP7PLPCard7ReducerfMe_.swift"
            );
            return fs.readFileSync(location("@__swiftmacro_3PLP7Card7ReducerfMe_.swift"), "utf-8");
        });
        console.log(JSON.stringify(problems, null));
        assert.deepStrictEqual(
            JSON.stringify(problems),
            JSON.stringify({
                "/Users/Ievgenii_Mykhalevskyi/repos/source1/Sources/Card/Card+Reducer.swift": [
                    {
                        severity: "Error",
                        message:
                            "Swift Macro Error: Conformance of 'Card' to protocol 'Reducer' crosses into main actor-isolated code and can cause data races\n\nMACRO ERROR:\nextension Card: ComposableArchitecture.Reducer {}\n\n// original-source-range: /Users/Ievgenii_Mykhalevskyi/repos/source1/Sources/Card/Card+Reducer.swift:175:2-175:2\n",
                        range: [
                            { line: 174, character: 1 },
                            { line: 174, character: 1 },
                        ],
                        source: "xcodebuild",
                    },
                ],
            })
        );
    });
});
