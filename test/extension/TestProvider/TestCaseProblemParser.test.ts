import * as assert from "assert";
import * as vscode from "vscode";
import { TestCaseProblemParser } from "../../../src/TestsProvider/RawLogParsers/TestCaseProblemParser";

suite("TestCaseProblemParser", () => {
    let parser: TestCaseProblemParser;

    setup(() => {
        parser = new TestCaseProblemParser();
    });

    suite("parseAsyncLogs", () => {
        test("should return empty array when testItem has no uri", async () => {
            const testItem = {
                id: "test",
                uri: undefined,
            } as vscode.TestItem;

            const result = await parser.parseAsyncLogs("", testItem);
            assert.strictEqual(result.length, 0);
        });

        test("should parse logs when testItem has uri", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "TestClass/testMethod",
                uri: uri,
            } as vscode.TestItem;

            const testCase = "/path/to/test.swift:10: error: Test failed\nerror:";
            const result = await parser.parseAsyncLogs(testCase, testItem);

            assert.ok(Array.isArray(result));
        });

        test("should extract test name from testItem id", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "TestClass/testMethod",
                uri: uri,
            } as vscode.TestItem;

            const testCase =
                "/path/to/test.swift:10: error: XCTAssertEqual failed: (1) is not equal to (2)\nerror:";
            const result = await parser.parseAsyncLogs(testCase, testItem);

            assert.ok(result.length > 0);
        });

        test("should handle empty testCase", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "test",
                uri: uri,
            } as vscode.TestItem;

            const result = await parser.parseAsyncLogs("", testItem);
            assert.strictEqual(result.length, 0);
        });
    });

    suite("parseBuildLog", () => {
        test("should parse simple error message", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "/path/to/test.swift:10: error: Test failed\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.strictEqual(result.length, 1);
            assert.ok(
                result[0].message instanceof vscode.MarkdownString ||
                    typeof result[0].message === "string"
            );
            assert.ok(result[0].location);
            assert.strictEqual(result[0].location?.uri.toString(), uri.toString());
        });

        test("should parse warning message", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "/path/to/test.swift:5: warning: Deprecated API\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.strictEqual(result.length, 1);
        });

        test("should parse note message", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "/path/to/test.swift:15: note: Additional information\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.strictEqual(result.length, 1);
        });

        test("should parse error with column number", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "/path/to/test.swift:10:5: error: Syntax error\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.strictEqual(result.length, 1);
            assert.ok(result[0].location);
        });

        test("should parse multiline error message", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log =
                "/path/to/test.swift:10: error: Test failed\nExpected value\nActual value\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.strictEqual(result.length, 1);
        });

        test("should parse multiple errors", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log =
                "/path/to/test.swift:10: error: First error\nerror:\n/path/to/test.swift:20: error: Second error\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.ok(result.length >= 1);
        });

        test("should handle line number correctly", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "/path/to/test.swift:42: error: Test failed\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].location?.range.start.line, 41); // 0-indexed
        });
    });

    suite("XCTAssert diff messages", () => {
        test("should parse XCTAssertEqual failure", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log =
                '/path/to/test.swift:10: error: XCTAssertEqual failed: ("actual") is not equal to ("expected")\nerror:';
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.strictEqual(result.length, 1);
            const message = result[0];
            assert.ok(message instanceof vscode.TestMessage);
        });

        test("should create diff message for XCTAssertEqual", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log =
                '/path/to/test.swift:10: error: XCTAssertEqual failed: ("foo") is not equal to ("bar")\nerror:';
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.strictEqual(result.length, 1);
        });

        test("should parse XCTAssertNotEqual failure", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log =
                '/path/to/test.swift:10: error: XCTAssertNotEqual failed: ("same") is equal to ("same")\nerror:';
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.strictEqual(result.length, 1);
        });

        test("should handle complex expected/actual values", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log =
                "/path/to/test.swift:10: error: XCTAssertEqual failed: ([1, 2, 3]) is not equal to ([1, 2, 4])\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.strictEqual(result.length, 1);
        });
    });

    suite("errorMessage extraction", () => {
        test("should extract message after 'failed:'", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log =
                "/path/to/test.swift:10: error: testMethod failed: assertion failed\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.ok(result.length > 0);
        });

        test("should extract message after delimiter colon", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "/path/to/test.swift:10: error: Test : assertion failed\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.ok(result.length > 0);
        });

        test("should return full message if no delimiter found", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "/path/to/test.swift:10: error: Simple error message\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.ok(result.length === 1);
        });
    });

    suite("markdown generation", () => {
        test("should generate markdown with file links", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log =
                "/path/to/test.swift:10: error: /another/file.swift:20: Referenced error\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.ok(result.length > 0);
            const message = result[0].message;
            assert.ok(message instanceof vscode.MarkdownString);
            if (message instanceof vscode.MarkdownString) {
                assert.ok(message.value.includes("vscode-ios.openFile"));
            } else {
                assert.fail("Message is not a MarkdownString");
            }
        });

        test("should mark markdown as trusted", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "/path/to/test.swift:10: error: Test failed\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.ok(result.length > 0);
            const message = result[0].message;
            assert.ok(message instanceof vscode.MarkdownString);
            if (message instanceof vscode.MarkdownString) {
                assert.strictEqual(message.isTrusted, true);
            } else {
                assert.fail("Message is not a MarkdownString");
            }
        });

        test("should handle SnapshotTesting diff messages", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = `/path/to/test.swift:10: error: Snapshot failed
@−
"file:///Users/Ievgenii_Mykhalevskyi/repos/source1/Experiences/Styling/Tests/SnapshotTests/Page/__Snapshots__/Tests/test_page_errorState.iPhone8.png"
@+
"file:///Users/Ievgenii_Mykhalevskyi/Library/Developer/CoreSimulator/Devices/C3BB0146-6E97-45A9-880C-D7CCE4FEBD27/data/Containers/Data/Application/A777B1A4-A209-4534-AE60-F4A65C044BC7/tmp/Tests/test_page_errorState.iPhone8.png"
To configure SnapshotTesting.diffTool
error:`;
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.ok(result.length > 0);
            const message = result[0].message;
            assert.ok(message instanceof vscode.MarkdownString);
            if (message instanceof vscode.MarkdownString) {
                assert.ok(message.value.includes("[Compare](command:vscode-ios.ksdiff?"));
                assert.ok(message.value.includes("test_page_errorState.iPhone8.png"));
            }
        });

        test("should generate compare command for snapshot failures", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = `/path/to/test.swift:10: error: @"file:///ref.png"
path/to/test.swift:10
random text

path/to/another.swift:20
@−
"file:///fail.png"
@+
"file:///actual.png"
Random end text
error: `;
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.ok(result.length > 0);
            const message = result[0].message;
            assert.ok(message instanceof vscode.MarkdownString);
            if (message instanceof vscode.MarkdownString) {
                assert.ok(message.value.includes("[Compare](command:vscode-ios.ksdiff?"));
                assert.ok(message.value.includes("[View line](command:vscode-ios.openFile?"));
                assert.ok(message.value.includes("path/to/test.swift"));
                assert.ok(message.value.includes("path/to/another.swift"));
                assert.ok(message.value.includes("fail.png"));
                assert.ok(message.value.includes("actual.png"));
            } else {
                assert.fail("Message is not a MarkdownString");
            }
        });
    });

    suite("edge cases", () => {
        test("should handle empty log gracefully", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const result = await parser.parseAsyncLogs("error:", testItem);
            assert.strictEqual(result.length, 0);
        });

        test("should handle malformed error patterns", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "not a valid error pattern\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.ok(Array.isArray(result));
        });

        test("should handle errors without trailing newline", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "/path/to/test.swift:10: error: Test failederror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.ok(Array.isArray(result));
        });

        test("should handle very long error messages", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const longMessage = "x".repeat(10000);
            const log = `/path/to/test.swift:10: error: ${longMessage}\nerror:`;
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.ok(result.length > 0);
        });

        test("should handle special characters in file paths", async () => {
            const uri = vscode.Uri.file("/path/with spaces/test-file_2.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "/path/with spaces/test-file_2.swift:10: error: Test failed\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.ok(result.length > 0);
        });

        test("should handle errors at line 0", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "/path/to/test.swift:0: error: Module error\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.ok(result.length === 0);
        });

        test("should handle parser exceptions gracefully", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            // Intentionally malformed to potentially trigger edge cases
            const log = "/path/to/test.swift:99999999999999999999: error: Test\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.ok(Array.isArray(result));
        });
    });

    suite("location and range", () => {
        test("should set correct line in location", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "/path/to/test.swift:25: error: Test failed\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].location?.range.start.line, 24);
            assert.strictEqual(result[0].location?.range.end.line, 24);
        });

        test("should set column range", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "/path/to/test.swift:10: error: Test failed\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.strictEqual(result.length, 1);
            assert.ok(result[0].location!.range!.start!.character! >= 0);
            assert.ok(result[0].location!.range!.end!.character! > 0);
        });

        test("should set location uri correctly", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = "/path/to/test.swift:10: error: Test failed\nerror:";
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].location?.uri.toString(), uri.toString());
        });
        test("should handle multiple", async () => {
            const uri = vscode.Uri.file("/path/to/test.swift");
            const testItem = {
                id: "testMethod",
                uri: uri,
            } as vscode.TestItem;

            const log = `
/Users/Ievgenii_Mykhalevskyi/repos/source1/Experiences/Styling/Tests/SnapshotTests/Page/Tests.swift:36: error: -[SnapshotTests.Tests test_page_errorState] : failed - Snapshot "iPhoneSe" does not match reference.

@−
"file:///Users/Ievgenii_Mykhalevskyi/repos/source1/Experiences/Styling/Tests/SnapshotTests/Page/__Snapshots__/Tests/test_page_errorState.iPhoneSe.png"
@+
"file:///Users/Ievgenii_Mykhalevskyi/Library/Developer/CoreSimulator/Devices/C3BB0146-6E97-45A9-880C-D7CCE4FEBD27/data/Containers/Data/Application/A777B1A4-A209-4534-AE60-F4A65C044BC7/tmp/Tests/test_page_errorState.iPhoneSe.png"

To configure output for a custom diff tool, use 'withSnapshotTesting'. For example:

    withSnapshotTesting(diffTool: .ksdiff) {
      // ...
    }

Actual image precision 0.94590193 is less than required 0.99
/Users/Ievgenii_Mykhalevskyi/repos/source1/Experiences/Styling/Tests/SnapshotTests/Page/Tests.swift:36: error: -[SnapshotTests.Tests test_page_errorState] : failed - Snapshot "iPhone8" does not match reference.

@−
"file:///Users/Ievgenii_Mykhalevskyi/repos/source1/Experiences/Styling/Tests/SnapshotTests/Page/__Snapshots__/Tests/test_page_errorState.iPhone8.png"
@+
"file:///Users/Ievgenii_Mykhalevskyi/Library/Developer/CoreSimulator/Devices/C3BB0146-6E97-45A9-880C-D7CCE4FEBD27/data/Containers/Data/Application/A777B1A4-A209-4534-AE60-F4A65C044BC7/tmp/Tests/test_page_errorState.iPhone8.png"

To configure output for a custom diff tool, use 'withSnapshotTesting'. For example:

    withSnapshotTesting(diffTool: .ksdiff) {
      // ...
    }

Actual image precision 0.9562744 is less than required 0.99
-[SnapshotTests.Tests test_page_errorState] : failed - Snapshot "iPhoneSe" does not match reference.
/user/path/test2.swift:10:
@−
"file:///Users/Ievgenii_Mykhalevskyi/repos/source1/Experiences/Styling/Tests/SnapshotTests/Page/__Snapshots__/Tests/test_page_errorState.iPhoneSe.png"
@+
"file:///Users/Ievgenii_Mykhalevskyi/Library/Developer/CoreSimulator/Devices/C3BB0146-6E97-45A9-880C-D7CCE4FEBD27/data/Containers/Data/Application/A777B1A4-A209-4534-AE60-F4A65C044BC7/tmp/Tests/test_page_errorState.iPhoneSe.png"

To configure output for a custom diff tool, use 'withSnapshotTesting'. For example:
/user/path/test2.swift:10:

    withSnapshotTesting(diffTool: .ksdiff) {
      // ...
    }

Actual image precision 0.94590193 is less than required 0.99
`;
            const result = await parser.parseAsyncLogs(log, testItem);

            assert.strictEqual(result.length, 2);
            if (result[0].message instanceof vscode.MarkdownString) {
                assert.ok(result[0].message.value.includes("command:vscode-ios.ksdiff"));
                assert.ok(result[0].message.value.includes("test_page_errorState.iPhoneSe.png"));
                assert.ok(!result[0].message.value.includes("test_page_errorState.iPhone8.png"));
            } else {
                assert.fail("Message is not a MarkdownString");
            }
            if (result[1].message instanceof vscode.MarkdownString) {
                assert.ok(result[1].message.value.includes("command:vscode-ios.ksdiff"));
                assert.ok(result[1].message.value.includes("test_page_errorState.iPhoneSe.png"));
                assert.ok(result[1].message.value.includes("test_page_errorState.iPhone8.png"));
            } else {
                assert.fail("Message is not a MarkdownString");
            }
            assert.deepStrictEqual(
                JSON.stringify(result),
                JSON.stringify([
                    {
                        message: {},
                        location: {
                            uri: { $mid: 1, path: "/path/to/test.swift", scheme: "file" },
                            range: [
                                { line: 35, character: 0 },
                                { line: 35, character: 10000 },
                            ],
                        },
                    },
                    {
                        message: {},
                        location: {
                            uri: { $mid: 1, path: "/path/to/test.swift", scheme: "file" },
                            range: [
                                { line: 35, character: 0 },
                                { line: 35, character: 10000 },
                            ],
                        },
                    },
                ])
            );
        });
    });
});
