import * as assert from "assert";
import * as vscode from "vscode";
import { TestResultProvider } from "../../../src/TestsProvider/TestResultProvider";
import * as fs from "fs";
import path = require("path");

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
        "TestProvider",
        "mocks",
        filePath
    );
}

suite("TestResultProvider", () => {
    let provider: TestResultProvider;

    setup(() => {
        provider = new TestResultProvider();
    });

    suite("parseExpectationFailed", () => {
        test("should return undefined for non-expectation messages", () => {
            const rawMessage = "Some random error message";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);
            assert.strictEqual(result, undefined);
        });

        test("should parse basic expectation with simple values", () => {
            const rawMessage = "Expectation failed: 5 == 10";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.ok(result instanceof vscode.TestMessage);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: "Expectation failed: 5 == 10",
                    expectedOutput: "5",
                    actualOutput: "10",
                })
            );
        });

        test("should parse expectation with variable names", () => {
            const rawMessage = "Expectation failed: (actual → 5) == (expected → 10)";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.ok(result instanceof vscode.TestMessage);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: "Expectation failed: (actual → 5) == (expected → 10)",
                    expectedOutput: "5",
                    actualOutput: "10",
                })
            );
        });

        test("should parse expectation with only left variable name", () => {
            const rawMessage = "Expectation failed: (count → 5) == 10";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.ok(result instanceof vscode.TestMessage);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: "Expectation failed: (count → 5) == 10",
                    expectedOutput: "10",
                    actualOutput: "5",
                })
            );
        });

        test("should parse expectation with only right variable name", () => {
            const rawMessage = "Expectation failed: 5 == (expected → 10)";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.ok(result instanceof vscode.TestMessage);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: "Expectation failed: 5 == (expected → 10)",
                    expectedOutput: "5",
                    actualOutput: "10",
                })
            );
        });

        test("should parse expectation with parenthesized values without variable names", () => {
            const rawMessage = "Expectation failed: (5) == (10)";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.ok(result instanceof vscode.TestMessage);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: "Expectation failed: (5) == (10)",
                    expectedOutput: "5",
                    actualOutput: "10",
                })
            );
        });

        test("should parse expectation with additional message", () => {
            const rawMessage = "Expectation failed: 5 == 10\nAdditional context here";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: "Additional context here",
                    expectedOutput: "5",
                    actualOutput: "10",
                })
            );
        });

        test("should include attributes in message when provided", () => {
            const rawMessage = "Expectation failed: 5 == 10";
            const attributes = "some attributes";
            const result = provider["parseExpectationFailed"](rawMessage, attributes);

            assert.ok(result);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: "Attributes: some attributes,\n Failed: Expectation failed: 5 == 10",
                    expectedOutput: "5",
                    actualOutput: "10",
                })
            );
        });

        test("should handle complex values with spaces", () => {
            const rawMessage =
                "Expectation failed: (value → hello world) == (expected → goodbye world)";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message:
                        "Expectation failed: (value → hello world) == (expected → goodbye world)",
                    expectedOutput: "hello world",
                    actualOutput: "goodbye world",
                })
            );
        });

        test("should handle multiline messages", () => {
            const rawMessage = "Expectation failed: 5 == 10\nLine 2\nLine 3";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: "Line 2\nLine 3",
                    expectedOutput: "5",
                    actualOutput: "10",
                })
            );
        });

        test("should return undefined when values are missing", () => {
            const rawMessage = "Expectation failed: == ";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.strictEqual(result, undefined);
        });

        test("should handle string values with special characters", () => {
            const rawMessage = 'Expectation failed: (text → "hello") == (expected → "world")';
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: 'Expectation failed: (text → "hello") == (expected → "world")',
                    expectedOutput: '"hello"',
                    actualOutput: '"world"',
                })
            );
        });

        test("should handle numeric values with decimals", () => {
            const rawMessage = "Expectation failed: 3.14 == 2.71";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: "Expectation failed: 3.14 == 2.71",
                    expectedOutput: "3.14",
                    actualOutput: "2.71",
                })
            );
        });

        test("should handle boolean values", () => {
            const rawMessage = "Expectation failed: true == false";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: "Expectation failed: true == false",
                    expectedOutput: "true",
                    actualOutput: "false",
                })
            );
        });

        test("should handle array representations", () => {
            const rawMessage = "Expectation failed: [1, 2, 3] == [4, 5, 6]";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: "Expectation failed: [1, 2, 3] == [4, 5, 6]",
                    expectedOutput: "[1, 2, 3]",
                    actualOutput: "[4, 5, 6]",
                })
            );
        });

        test("should return undefined on malformed expectation", () => {
            const rawMessage = "Expectation failed: incomplete";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.strictEqual(result, undefined);
        });

        test("should handle empty string values", () => {
            const rawMessage = 'Expectation failed: "" == "something"';
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: `Expectation failed: "" == "something"`,
                    expectedOutput: `""`,
                    actualOutput: `"something"`,
                })
            );
        });

        test("should handle nil/null values", () => {
            const rawMessage = "Expectation failed: nil == Optional(5)";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: "Expectation failed: nil == Optional(5)",
                    expectedOutput: "nil",
                    actualOutput: "Optional(5)",
                })
            );
        });

        test("should not handle < operators", () => {
            const rawMessage = "Expectation failed: 1 < (b → 0): Failed";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.strictEqual(result, undefined);
        });

        test("should not handle not != operators", () => {
            const rawMessage = "Expectation failed: 1 != (b → 0): Failed";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.strictEqual(result, undefined);
        });

        test("should not handle Custom Struct 1", () => {
            const rawMessage = `Expectation failed: (c → CustomStruct(a: "Prop_a", op: 10, list: ["First", "Second"])) == (b → CustomStruct(a: "Prop_b", op: 10, list: ["First", "Third", "Second"]))`;
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: `Expectation failed: (c → CustomStruct(a: "Prop_a", op: 10, list: ["First", "Second"])) == (b → CustomStruct(a: "Prop_b", op: 10, list: ["First", "Third", "Second"]))`,
                    expectedOutput: `CustomStruct(a: "Prop_a", op: 10, list: ["First", "Second"])`,
                    actualOutput: `CustomStruct(a: "Prop_b", op: 10, list: ["First", "Third", "Second"])`,
                })
            );
        });

        test("should not handle Custom Struct 2", () => {
            const rawMessage = `Expectation failed: (c → CustomStruct(a: "Prop_a", op: 10, list: ["First", "Second"])) == CustomStruct(a: "Prop_b", op: 10, list: ["First", "Third", "Second"])"`;
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: `Expectation failed: (c → CustomStruct(a: "Prop_a", op: 10, list: ["First", "Second"])) == CustomStruct(a: "Prop_b", op: 10, list: ["First", "Third", "Second"])"`,
                    expectedOutput: `CustomStruct(a: "Prop_b", op: 10, list: ["First", "Third", "Second"])`,
                    actualOutput: `CustomStruct(a: "Prop_a", op: 10, list: ["First", "Second"])`,
                })
            );
        });

        test("should not handle Custom Struct 3", () => {
            const rawMessage = `Expectation failed: (c → CustomStruct(a: "Prop\\"_a", op: 10, list: ["First", "Seco\\'nd"])) == CustomStruct(a: "Prop_)b", op: 10, list: ["First", "Third", "Second"])"`;
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify({
                    message: `Expectation failed: (c → CustomStruct(a: "Prop\\"_a", op: 10, list: ["First", "Seco\\'nd"])) == CustomStruct(a: "Prop_)b", op: 10, list: ["First", "Third", "Second"])"`,
                    expectedOutput: `CustomStruct(a: "Prop_)b", op: 10, list: ["First", "Third", "Second"])`,
                    actualOutput: `CustomStruct(a: "Prop\\"_a", op: 10, list: ["First", "Seco\\'nd"])`,
                })
            );
        });

        test("should gracefully handle exceptions during parsing", () => {
            const rawMessage = "Expectation failed: (→) == (→)";
            assert.doesNotThrow(() => {
                provider["parseExpectationFailed"](rawMessage, undefined);
            });
        });

        test("should preserve original message when parsing fails", () => {
            const rawMessage = "Not an expectation message";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.strictEqual(result, undefined);
        });

        test("should handle values with equals signs in them", () => {
            const rawMessage = "Expectation failed: a=b == c=d";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
        });

        test("should handle closing parenthesis in message", () => {
            const rawMessage = "Expectation failed: 5 == 10) extra text";
            const result = provider["parseExpectationFailed"](rawMessage, undefined);

            assert.ok(result);
        });
    });

    suite("Json Test Parsing", () => {
        test("XCResult Test Parsing logic", async () => {
            const output = fs.readFileSync(location("xcodebuild_result_parser.json")).toString();
            const list: any[] = [];
            await provider.parse(
                output,
                (key: string) => {
                    return key;
                },
                (key, result, rawMessage, message, duration) => {
                    list.push({ key, result, rawMessage, message, duration });
                }
            );
            assert.deepStrictEqual(
                JSON.stringify(list),
                JSON.stringify([
                    {
                        key: "Test_iosTests/New_TEST_FRAMEWORK()",
                        result: "failed",
                        rawMessage:
                            "Test_iosTests.swift:58: Expectation failed: (a → 0) == (b → 1)",
                        message: [
                            {
                                message: "Expectation failed: (a → 0) == (b → 1)",
                                expectedOutput: "0",
                                actualOutput: "1",
                                location: {
                                    uri: {
                                        $mid: 1,
                                        path: "/Test_iosTests/New_TEST_FRAMEWORK()",
                                        scheme: "file",
                                    },
                                    range: [
                                        { line: 57, character: 0 },
                                        { line: 57, character: 0 },
                                    ],
                                },
                            },
                        ],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/WOW()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/test2()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/Test()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/Test_iosTests/test_newTest()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0.00077,
                    },
                    {
                        key: "Test_iosTests/Test_iosTests/testbeter()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0.00057,
                    },
                    {
                        key: "Test_iosTests/Test_iosTests/testBEtter()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0.00053,
                    },
                    {
                        key: "Test_iosTests/Test_iosTests/testExample()",
                        result: "failed",
                        rawMessage: "Test_iosTests.swift:24: XCTAssertFalse failed",
                        message: [
                            {
                                message: "XCTAssertFalse failed",
                                location: {
                                    uri: {
                                        $mid: 1,
                                        path: "/Test_iosTests/Test_iosTests/testExample()",
                                        scheme: "file",
                                    },
                                    range: [
                                        { line: 23, character: 0 },
                                        { line: 23, character: 0 },
                                    ],
                                },
                            },
                        ],
                        duration: 0.27,
                    },
                    {
                        key: "Test_iosTests/Test_iosTests/testOpen()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0.00067,
                    },
                    {
                        key: "Test_iosTests/Test_iosTests/testPerformanceExample()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0.26,
                    },
                    {
                        key: "Test_iosTests/Suite/SuiteSubTests/opacha()",
                        result: "failed",
                        rawMessage: 'Test_iosTests.swift:65: Expectation failed: "1" == "2"',
                        message: [
                            {
                                message: 'Expectation failed: "1" == "2"',
                                expectedOutput: '"1"',
                                actualOutput: '"2"',
                                location: {
                                    uri: {
                                        $mid: 1,
                                        path: "/Test_iosTests/Suite/SuiteSubTests/opacha()",
                                        scheme: "file",
                                    },
                                    range: [
                                        { line: 64, character: 0 },
                                        { line: 64, character: 0 },
                                    ],
                                },
                            },
                        ],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/Suite/SuiteSubTests/opacha2()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/Suite/BetteNow/Third/third_test()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/Suite/BetteNow/open_test_now()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/Suite/BetteNow/skipped_test_now(a:)",
                        result: "failed",
                        rawMessage:
                            'Arguments:"A Beach" -> Passed\nArguments:"By The Lake" -> Failed\n\tTest_iosTests.swift:102: Expectation failed: (a → "By The Lake") == "A Beach": This is a simple error message\nArguments:"Third Beach" -> Failed\n\tTest_iosTests.swift:102: Expectation failed: (a → "Third Beach") == "A Beach": This is a simple error message',
                        message: [
                            {
                                message:
                                    'Attributes: "By The Lake",\n Failed: This is a simple error message',
                                expectedOutput: '"A Beach"',
                                actualOutput: '"By The Lake"',
                                location: {
                                    uri: {
                                        $mid: 1,
                                        path: "/Test_iosTests/Suite/BetteNow/skipped_test_now(a:)",
                                        scheme: "file",
                                    },
                                    range: [
                                        { line: 101, character: 0 },
                                        { line: 101, character: 0 },
                                    ],
                                },
                            },
                            {
                                message:
                                    'Attributes: "Third Beach",\n Failed: This is a simple error message',
                                expectedOutput: '"A Beach"',
                                actualOutput: '"Third Beach"',
                                location: {
                                    uri: {
                                        $mid: 1,
                                        path: "/Test_iosTests/Suite/BetteNow/skipped_test_now(a:)",
                                        scheme: "file",
                                    },
                                    range: [
                                        { line: 101, character: 0 },
                                        { line: 101, character: 0 },
                                    ],
                                },
                            },
                        ],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/Suite/BetteNow/oneAnother()",
                        result: "failed",
                        rawMessage:
                            "Test_iosTests.swift:107: Expectation failed: (b → 0) > 1: Failed",
                        message: [
                            {
                                message: "Expectation failed: (b → 0) > 1: Failed",
                                location: {
                                    uri: {
                                        $mid: 1,
                                        path: "/Test_iosTests/Suite/BetteNow/oneAnother()",
                                        scheme: "file",
                                    },
                                    range: [
                                        { line: 106, character: 0 },
                                        { line: 106, character: 0 },
                                    ],
                                },
                            },
                        ],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/Suite/BetteNow/multiFailed()",
                        result: "failed",
                        rawMessage:
                            'Test_iosTests.swift:111: Expectation failed: 1 == 2\nTest_iosTests.swift:115: Expectation failed: (c → CustomStruct(a: "Prop\\"\\\'_a", op: 10, list: ["F)rst", "Sec][{ond"])) == (b → CustomStruct(a: "Prop_b", op: 10, list: ["First", "Third", "S\\"econd"]))\nTest_iosTests.swift:117: Expectation failed: (c → CustomStruct(a: "Prop\\"\\\'_a", op: 10, list: ["F)rst", "Sec][{ond"])) == CustomStruct(a: "Prop_b", op: 10, list: ["First", "Third", "Second"])',
                        message: [
                            {
                                message: "Expectation failed: 1 == 2",
                                expectedOutput: "1",
                                actualOutput: "2",
                                location: {
                                    uri: {
                                        $mid: 1,
                                        path: "/Test_iosTests/Suite/BetteNow/multiFailed()",
                                        scheme: "file",
                                    },
                                    range: [
                                        { line: 110, character: 0 },
                                        { line: 110, character: 0 },
                                    ],
                                },
                            },
                            {
                                message:
                                    'Expectation failed: (c → CustomStruct(a: "Prop\\"\\\'_a", op: 10, list: ["F)rst", "Sec][{ond"])) == (b → CustomStruct(a: "Prop_b", op: 10, list: ["First", "Third", "S\\"econd"]))',
                                expectedOutput:
                                    'CustomStruct(a: "Prop\\"\\\'_a", op: 10, list: ["F)rst", "Sec][{ond"])',
                                actualOutput:
                                    'CustomStruct(a: "Prop_b", op: 10, list: ["First", "Third", "S\\"econd"])',
                                location: {
                                    uri: {
                                        $mid: 1,
                                        path: "/Test_iosTests/Suite/BetteNow/multiFailed()",
                                        scheme: "file",
                                    },
                                    range: [
                                        { line: 114, character: 0 },
                                        { line: 114, character: 0 },
                                    ],
                                },
                            },
                            {
                                message:
                                    'Expectation failed: (c → CustomStruct(a: "Prop\\"\\\'_a", op: 10, list: ["F)rst", "Sec][{ond"])) == CustomStruct(a: "Prop_b", op: 10, list: ["First", "Third", "Second"])',
                                expectedOutput:
                                    'CustomStruct(a: "Prop_b", op: 10, list: ["First", "Third", "Second"])',
                                actualOutput:
                                    'CustomStruct(a: "Prop\\"\\\'_a", op: 10, list: ["F)rst", "Sec][{ond"])',
                                location: {
                                    uri: {
                                        $mid: 1,
                                        path: "/Test_iosTests/Suite/BetteNow/multiFailed()",
                                        scheme: "file",
                                    },
                                    range: [
                                        { line: 116, character: 0 },
                                        { line: 116, character: 0 },
                                    ],
                                },
                            },
                        ],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/Suite/BetteNow/second()",
                        result: "failed",
                        rawMessage:
                            'Test_iosTests.swift:122: Expectation failed: (a → "afd") == "bsd": Second',
                        message: [
                            {
                                message: "Second",
                                expectedOutput: '"bsd"',
                                actualOutput: '"afd"',
                                location: {
                                    uri: {
                                        $mid: 1,
                                        path: "/Test_iosTests/Suite/BetteNow/second()",
                                        scheme: "file",
                                    },
                                    range: [
                                        { line: 121, character: 0 },
                                        { line: 121, character: 0 },
                                    ],
                                },
                            },
                        ],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/Suite/BetteNow/one_Day()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/Suite/SUITED_TEST()",
                        result: "failed",
                        rawMessage: 'Test_iosTests.swift:73: Expectation failed: "a" == "b"',
                        message: [
                            {
                                message: 'Expectation failed: "a" == "b"',
                                expectedOutput: '"a"',
                                actualOutput: '"b"',
                                location: {
                                    uri: {
                                        $mid: 1,
                                        path: "/Test_iosTests/Suite/SUITED_TEST()",
                                        scheme: "file",
                                    },
                                    range: [
                                        { line: 72, character: 0 },
                                        { line: 72, character: 0 },
                                    ],
                                },
                            },
                        ],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/Suite/open()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/Suite/SUITED_TEST2()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0,
                    },
                    {
                        key: "Test_iosTests/Suite/SUITED_TEST3()",
                        result: "passed",
                        rawMessage: "",
                        message: [],
                        duration: 0,
                    },
                ])
            );
        });
    });
});
