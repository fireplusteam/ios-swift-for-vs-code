import * as assert from "assert";
import * as vscode from "vscode";
import { TestResultProvider } from "../../../src/TestsProvider/TestResultProvider";
import { off } from "process";

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
});
