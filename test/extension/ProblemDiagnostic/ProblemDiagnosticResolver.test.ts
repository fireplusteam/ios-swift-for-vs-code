import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as sinon from "sinon";
import {
    ProblemDiagnosticResolver,
    RawBuildParser,
    _private,
} from "../../../src/ProblemDiagnosticResolver";

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
    let log: vscode.OutputChannel;
    setup(() => {
        log = vscode.window.createOutputChannel("ProblemDiagnosticResolverTest");
    });

    teardown(() => {
        log.dispose();
    });

    test("Test 1: Empty", () => {
        const output = fs.readFileSync(location("build_log_empty.txt")).toString();
        const result = _private.parseBuildLog("build.log", output, 0, log, () => true);
        assert.deepStrictEqual(result, {});
    });

    test("Test 2: Success", () => {
        const output = fs.readFileSync(location("build_log_success.txt")).toString();
        const result = _private.parseBuildLog("build.log", output, 0, log, () => true);
        assert.deepStrictEqual(result, {});
    });

    test("Test 3: Errors", () => {
        const output = fs.readFileSync(location("build_log_with_errors.txt")).toString();
        const result = _private.parseBuildLog("build.log", output, 0, log, () => true);
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
        const result = _private.parseBuildLog("build.log", output, 0, log, () => true);
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
        const result = _private.parseBuildLog("build.log", output, 0, log, () => true);
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
        const result = _private.parseBuildLog("build.log", output, 0, log, () => true);
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
        const log = vscode.window.createOutputChannel("ProblemDiagnosticResolverTest");
        const problems = _private.parseSwiftMacrosInXcodeBuildLogs(
            buildLogInput,
            filepath => {
                assert.strictEqual(
                    filepath,
                    "/private/var/folders/cf/szyj4d9j2j5dkh0ctxhh_djc0000gn/T/swift-generated-sources/@__swiftmacro_3PLP7PLPCard7ReducerfMe_.swift"
                );
                return fs.readFileSync(
                    location("@__swiftmacro_3PLP7Card7ReducerfMe_.swift"),
                    "utf-8"
                );
            },
            log
        );
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
suite("ProblemDiagnosticResolver Class Tests", () => {
    let resolver: ProblemDiagnosticResolver;
    let diagnosticCollection: vscode.DiagnosticCollection;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        diagnosticCollection = {
            set: sandbox.stub(),
            get: sandbox.stub().returns([]),
            delete: sandbox.stub(),
            clear: sandbox.stub(),
            forEach: sandbox.stub(),
            dispose: sandbox.stub(),
            name: "Xcode",
            has: sandbox.stub().returns(false),
        } as any;

        sandbox.stub(vscode.languages, "createDiagnosticCollection").returns(diagnosticCollection);
        sandbox
            .stub(vscode.workspace, "onDidChangeTextDocument")
            .returns({ dispose: () => {} } as any);
        sandbox
            .stub(vscode.workspace, "onDidCloseTextDocument")
            .returns({ dispose: () => {} } as any);
        sandbox.stub(vscode.workspace, "onDidDeleteFiles").returns({ dispose: () => {} } as any);

        const log = vscode.window.createOutputChannel("ProblemDiagnosticResolverTest");
        resolver = new ProblemDiagnosticResolver(log);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("isSourcekit predicate returns true for non-xcodebuild sources", () => {
        assert.strictEqual(ProblemDiagnosticResolver.isSourcekit("sourcekit"), true);
        assert.strictEqual(ProblemDiagnosticResolver.isSourcekit("other"), true);
        assert.strictEqual(ProblemDiagnosticResolver.isSourcekit("xcodebuild"), false);
    });

    test("isXcodebuild predicate returns true for xcodebuild source", () => {
        assert.strictEqual(ProblemDiagnosticResolver.isXcodebuild("xcodebuild"), true);
        assert.strictEqual(ProblemDiagnosticResolver.isXcodebuild("sourcekit"), false);
        assert.strictEqual(ProblemDiagnosticResolver.isXcodebuild(""), false);
    });

    test("handleDiagnostics stores diagnostics correctly", () => {
        const uri = vscode.Uri.file("/test/file.swift");
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 10),
            "Test error",
            vscode.DiagnosticSeverity.Error
        );
        diagnostic.source = "sourcekit";

        resolver.handleDiagnostics(uri, ProblemDiagnosticResolver.isSourcekit, [diagnostic]);

        assert.ok((diagnosticCollection.set as sinon.SinonStub).called);
    });

    test("isDiagnosticFromSwiftMacroError identifies macro errors", () => {
        const macroError = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 10),
            "Swift Macro Error: some error",
            vscode.DiagnosticSeverity.Error
        );
        const normalError = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 10),
            "Normal error",
            vscode.DiagnosticSeverity.Error
        );

        assert.strictEqual((resolver as any).isDiagnosticFromSwiftMacroError(macroError), true);
        assert.strictEqual((resolver as any).isDiagnosticFromSwiftMacroError(normalError), false);
    });

    test("parseStdout processes build output correctly", () => {
        const rawParser = new RawBuildParser("/test/build.log");
        rawParser.stdout = "/test/file.swift:10:5: error: test error\n^\n";

        (resolver as any).parseStdout(rawParser, false, () => true);

        assert.strictEqual(rawParser.triggerCharacter, "^");
        assert.ok((diagnosticCollection.set as sinon.SinonStub).called);
    });

    test("parseStdout handles shouldEnd flag", () => {
        const rawParser = new RawBuildParser("/test/build.log");
        rawParser.stdout = "/test/file.swift:10:5: error: incomplete";

        (resolver as any).parseStdout(rawParser, true, () => true);

        assert.ok((diagnosticCollection.set as sinon.SinonStub).called);
    });

    test("parseStdout sets isError flag when errors are present", () => {
        const rawParser = new RawBuildParser("/test/build.log");
        rawParser.stdout = "/test/file.swift:10:5: error: test error\n^\n";
        rawParser.isError = false;

        (resolver as any).parseStdout(rawParser, false, () => true);

        assert.strictEqual(rawParser.isError, true);
    });

    test("parseStdout does not set isError flag for warnings", () => {
        const rawParser = new RawBuildParser("/test/build.log");
        rawParser.stdout = "/test/file.swift:10:5: warning: test warning\n^\n";
        rawParser.isError = false;

        (resolver as any).parseStdout(rawParser, false, () => true);

        assert.strictEqual(rawParser.isError, false);
    });

    test("uniqueDiagnostics removes duplicate diagnostics", () => {
        const diag1 = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 10),
            "duplicate error",
            vscode.DiagnosticSeverity.Error
        );
        const diag2 = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 10),
            "duplicate error",
            vscode.DiagnosticSeverity.Error
        );
        const diag3 = new vscode.Diagnostic(
            new vscode.Range(1, 0, 1, 10),
            "different error",
            vscode.DiagnosticSeverity.Error
        );

        const result = (resolver as any).uniqueDiagnostics([diag1, diag2, diag3], []);

        assert.strictEqual(result.length, 2);
    });

    test("uniqueDiagnostics filters against existing items", () => {
        const existing = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 10),
            "existing error",
            vscode.DiagnosticSeverity.Error
        );
        const duplicate = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 15),
            "existing error",
            vscode.DiagnosticSeverity.Error
        );
        const newItem = new vscode.Diagnostic(
            new vscode.Range(1, 0, 1, 10),
            "new error",
            vscode.DiagnosticSeverity.Error
        );

        const result = (resolver as any).uniqueDiagnostics([duplicate, newItem], [existing]);

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].message, "new error");
    });

    test("refreshPreviousBuildDiagnostics clears and rebuilds tracking set", () => {
        const uri1 = vscode.Uri.file("/test/file1.swift");
        const uri2 = vscode.Uri.file("/test/file2.swift");

        const diag1 = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 10),
            "error",
            vscode.DiagnosticSeverity.Error
        );
        diag1.source = "xcodebuild";

        (diagnosticCollection.forEach as sinon.SinonStub).callsFake((callback: any) => {
            callback(uri1, [diag1]);
            callback(uri2, []);
        });

        (resolver as any).refreshPreviousBuildDiagnostics();

        assert.ok((diagnosticCollection.forEach as sinon.SinonStub).called);
        assert.ok((resolver as any).filesWithPreviousBuildDiagnostics.has("/test/file1.swift"));
        assert.ok(!(resolver as any).filesWithPreviousBuildDiagnostics.has("/test/file2.swift"));
    });
});

suite("RawBuildParser Tests", () => {
    test("RawBuildParser initializes with correct defaults", () => {
        const parser = new RawBuildParser("/test/build.log");

        assert.strictEqual(parser.firstIndex, 0);
        assert.strictEqual(parser.triggerCharacter, "^");
        assert.strictEqual(parser.isError, false);
        assert.strictEqual(parser.numberOfLines, 0);
        assert.strictEqual(parser.stdout, "");
        assert.strictEqual(parser.buildLogFile, "/test/build.log");
        assert.strictEqual(parser.watcherDisposal, undefined);
    });
});
