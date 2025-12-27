import * as assert from "assert";
import * as fs from "fs";
import * as vscode from "vscode";
import {
    TestCaseAsyncParser,
    RawTestParser,
} from "../../../src/TestsProvider/RawLogParsers/TestCaseAsyncParser";
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

suite("TestCaseAsyncParser", () => {
    let parser: TestCaseAsyncParser;

    setup(() => {
        parser = new TestCaseAsyncParser();
    });

    teardown(() => {
        parser.disposable.forEach(d => d.dispose());
    });

    suite("RawTestParser", () => {
        test("should initialize with empty stdout", () => {
            const rawParser = new RawTestParser("");
            assert.strictEqual(rawParser.stdout, "");
            assert.strictEqual(rawParser.watcherDisposal, undefined);
        });

        test("should initialize with provided stdout", () => {
            const rawParser = new RawTestParser("test output");
            assert.strictEqual(rawParser.stdout, "test output");
        });
    });

    suite("parseAsyncLogs", () => {
        test("should create RawTestParser and attach event listener", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            assert.ok(rawParser);
            assert.ok(rawParser.watcherDisposal);
            assert.strictEqual(rawParser.stdout, "");
            parser.end(rawParser);
            assert.ok(rawParser.watcherDisposal === undefined);

            emitter.dispose();
        });

        test("should parse passed test case", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            const testLog = `Test Case '-[MyTarget.MyTests testExample]' started.
Test Case '-[MyTarget.MyTests testExample]' passed (0.001 seconds).`;

            emitter.fire(testLog);
            parser.end(rawParser);

            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0][0], "passed");
            assert.strictEqual(messages[0][2], "MyTarget");
            assert.strictEqual(messages[0][3], "MyTests");
            assert.strictEqual(messages[0][4], "testExample");
            assert.strictEqual(messages[0][5], 0.001);

            emitter.dispose();
        });

        test("should parse passed test case which is not the start of line", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            const testLog = `Test Case '-[MyTarget.MyTests testExample]' started. Some random text beforeTest Case '-[MyTarget.MyTests testExample]' passed (0.001 seconds).`;

            emitter.fire(testLog);
            parser.end(rawParser);

            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0][0], "passed");
            assert.strictEqual(messages[0][2], "MyTarget");
            assert.strictEqual(messages[0][3], "MyTests");
            assert.strictEqual(messages[0][4], "testExample");
            assert.strictEqual(messages[0][5], 0.001);

            emitter.dispose();
        });

        test("should parse failed test case", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            const testLog = `Test Case '-[MyTarget.MyTests testFailure]' started.
Some error message
Test Case '-[MyTarget.MyTests testFailure]' failed (0.523 seconds).`;

            emitter.fire(testLog);
            parser.end(rawParser);

            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0][0], "failed");
            assert.strictEqual(messages[0][1].includes("Some error message"), true);
            assert.strictEqual(messages[0][2], "MyTarget");
            assert.strictEqual(messages[0][3], "MyTests");
            assert.strictEqual(messages[0][4], "testFailure");
            assert.strictEqual(messages[0][5], 0.523);

            emitter.dispose();
        });

        test("should parse multiple test cases in sequence", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            emitter.fire(`Test Case '-[Target1.Class1 test1]' started.
Test Case '-[Target1.Class1 test1]' passed (0.001 seconds).`);

            emitter.fire(`Test Case '-[Target2.Class2 test2]' started.
Test Case '-[Target2.Class2 test2]' passed (0.002 seconds).`);

            parser.end(rawParser);

            assert.strictEqual(messages.length, 2);
            assert.strictEqual(messages[0][2], "Target1");
            assert.strictEqual(messages[0][3], "Class1");
            assert.strictEqual(messages[0][4], "test1");
            assert.strictEqual(messages[1][2], "Target2");
            assert.strictEqual(messages[1][3], "Class2");
            assert.strictEqual(messages[1][4], "test2");

            emitter.dispose();
        });

        test("should handle partial test output", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            emitter.fire(`Test Case '-[MyTarget.MyTests testExample]' started.\n`);
            assert.strictEqual(messages.length, 0);
            emitter.fire("\n");
            emitter.fire(`Test Case '-[MyTarget.MyTests testExample]' passed (0.001 seconds).\n`);
            assert.strictEqual(messages.length, 1);
            parser.end(rawParser);

            emitter.dispose();
        });

        test("should accumulate stdout across multiple events", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            emitter.fire(`Test Case '-[MyTarget.MyTests test1]' started.\n`);
            emitter.fire(`Test Case '-[MyTarget.MyTests test1]' passed (0.001 seconds).\n`);
            emitter.fire(`Test Case '-[MyTarget.MyTests test2]' started.\n`);
            emitter.fire(`Test Case '-[MyTarget.MyTests test2]' passed (0.002 seconds).`);
            parser.end(rawParser);

            assert.strictEqual(messages.length, 2);

            emitter.dispose();
        });

        test("parse success real logs", () => {
            const output = fs.readFileSync(location("xcodebuild_success_tests_logs.txt"), "utf-8");
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });
            output.split(" ").forEach(line => {
                emitter.fire(line + " ");
            });
            parser.end(rawParser);
            emitter.dispose();

            assert.deepStrictEqual(
                JSON.stringify(messages),
                JSON.stringify([
                    ["passed", "\n", "TargetUnitTests", "TARGResolverTests", "test_1", 0.001],
                    ["passed", "\n", "TargetUnitTests", "TARGResolverTests", "test_2", 0.001],
                    ["passed", "\n", "TargetUnitTests", "TARGResolverTests", "test_3", 0.002],
                ])
            );
        });

        test("should handle test case with multiline error output", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            const testLog = `Test Case '-[MyTarget.MyTests testError]' started.
/path/to/file.swift:10: error: XCTAssertEqual failed
Expected: 1
Actual: 2
Test Case '-[MyTarget.MyTests testError]' failed (0.100 seconds).`;

            emitter.fire(testLog);
            parser.end(rawParser);

            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0][0], "failed");
            assert.ok(messages[0][1].includes("XCTAssertEqual failed"));
            assert.ok(messages[0][1].includes("Expected: 1"));
            assert.ok(messages[0][1].includes("Actual: 2"));

            emitter.dispose();
        });

        test("should stop at Test Suite terminator", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            const testLog = `Test Case '-[MyTarget.MyTests test1]' started.
Test Suite 'All tests' passed`;

            emitter.fire(testLog);
            parser.end(rawParser);

            assert.strictEqual(messages.length, 1);

            emitter.dispose();
        });

        test("should stop at Test session results terminator", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            const testLog = `Test Case '-[MyTarget.MyTests test1]' started.
Test session results summary`;

            emitter.fire(testLog);
            parser.end(rawParser);

            assert.strictEqual(messages.length, 1);

            emitter.dispose();
        });
    });

    suite("end", () => {
        test("should dispose watcher and clear disposal reference", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            assert.ok(rawParser.watcherDisposal);

            parser.end(rawParser);

            assert.strictEqual(rawParser.watcherDisposal, undefined);

            emitter.dispose();
        });

        test("should handle calling end multiple times", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            parser.end(rawParser);
            assert.doesNotThrow(() => parser.end(rawParser));

            emitter.dispose();
        });

        test("should stop receiving events after end", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            parser.end(rawParser);

            emitter.fire(`Test Case '-[MyTarget.MyTests test1]' started.
Test Case '-[MyTarget.MyTests test1]' passed (0.001 seconds).`);

            assert.strictEqual(messages.length, 0);

            emitter.dispose();
        });
    });

    suite("stdout management", () => {
        test("should clear processed stdout after parsing", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            const testLog = `Test Case '-[MyTarget.MyTests test1]' started.
Test Case '-[MyTarget.MyTests test1]' passed (0.001 seconds).`;

            emitter.fire(testLog);

            assert.ok(rawParser.stdout.length < testLog.length);

            emitter.dispose();
        });

        test("should retain unprocessed stdout", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            emitter.fire(`Test Case '-[MyTarget.MyTests test1]' started.`);

            assert.ok(rawParser.stdout.includes("started"));

            emitter.dispose();
        });
    });

    suite("edge cases", () => {
        test("should handle empty string events", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            emitter.fire("");
            parser.end(rawParser);
            assert.strictEqual(messages.length, 0);

            emitter.dispose();
        });

        test("should handle test names with special characters", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            const testLog = `Test Case '-[MyTarget.MyTests test_With_Underscores]' started.
Test Case '-[MyTarget.MyTests test_With_Underscores]' passed (0.001 seconds).`;

            emitter.fire(testLog);
            parser.end(rawParser);

            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0][4], "test_With_Underscores");

            emitter.dispose();
        });

        test("should handle very large duration values", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            const testLog = `Test Case '-[MyTarget.MyTests slowTest]' started.
Test Case '-[MyTarget.MyTests slowTest]' passed (123.456 seconds).`;

            emitter.fire(testLog);
            parser.end(rawParser);

            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0][5], 123.456);

            emitter.dispose();
        });

        test("should handle test case without explicit result", () => {
            const emitter = new vscode.EventEmitter<string>();
            const messages: any[] = [];

            const rawParser = parser.parseAsyncLogs(emitter.event, (...args) => {
                messages.push(args);
            });

            const testLog = `Test Case '-[MyTarget.MyTests test1]' started.
Test Session interrupted`;

            emitter.fire(testLog);
            parser.end(rawParser);

            assert.strictEqual(messages.length, 0);

            emitter.dispose();
        });
    });
});
