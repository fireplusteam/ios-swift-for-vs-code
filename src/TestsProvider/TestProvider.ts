import * as vscode from "vscode";
import { TestFile } from "./TestItemProvider/TestFile";
import { TestCase } from "./TestItemProvider/TestCase";
import { TestProject } from "./TestItemProvider/TestProject";
import { ProjectManager } from "../ProjectManager/ProjectManager";
import { TestTarget } from "./TestItemProvider/TestTarget";
import { emptyTestsLog } from "../utils";
import { TestCaseAsyncParser } from "./RawLogParsers/TestCaseAsyncParser";
import { TestTreeContext } from "./TestTreeContext";
import { TestCaseProblemParser } from "./RawLogParsers/TestCaseProblemParser";
import { CommandContext } from "../CommandManagement/CommandContext";
import { BundlePath } from "../CommandManagement/BundlePath";
import * as path from "path";
import { Mutex } from "async-mutex";
import { LogChannelInterface } from "../Logs/LogChannel";
import * as fs from "fs";

enum TestProviderLoadingState {
    nonInitialized,
    loading,
    loaded,
    error,
}

class TestRunRequest extends vscode.TestRunRequest {
    testPlan: string | undefined;
    context: CommandContext | undefined;
    constructor(
        testPlan: string | undefined = undefined,
        context: CommandContext | undefined = undefined
    ) {
        super();
        this.testPlan = testPlan;
        this.context = context;
    }
}

export class TestProvider {
    projectManager: ProjectManager;
    executeTests: (
        tests: string[],
        isDebuggable: boolean,
        testRun: vscode.TestRun,
        context: CommandContext,
        testPlan: string | undefined,
        isCoverage: boolean
    ) => Promise<boolean>;
    context: TestTreeContext;
    asyncParser = new TestCaseAsyncParser();
    asyncTestCaseParser: TestCaseProblemParser;

    private loadingState: TestProviderLoadingState = TestProviderLoadingState.nonInitialized;
    private initialFilesLoadingMutex = new Mutex();
    private readonly log: LogChannelInterface;
    private _runTestPlan?: (testPlan: string, commandContext: CommandContext) => Promise<void>;

    constructor(
        projectManager: ProjectManager,
        context: TestTreeContext,
        log: LogChannelInterface,
        executeTests: (
            tests: string[],
            isDebuggable: boolean,
            testRun: vscode.TestRun,
            context: CommandContext,
            testPlan: string | undefined,
            isCoverage: boolean
        ) => Promise<boolean>
    ) {
        this.projectManager = projectManager;
        this.context = context;
        this.executeTests = executeTests;
        this.log = log;
        this.asyncTestCaseParser = new TestCaseProblemParser(this.log);
    }

    async runTestPlan(testPlan: string, commandContext: CommandContext) {
        if (this._runTestPlan) {
            await this._runTestPlan(testPlan, commandContext);
        }
    }

    activateTests(context: vscode.ExtensionContext) {
        const ctrl = this.context.ctrl;
        context.subscriptions.push(ctrl);

        const runHandler = (request: vscode.TestRunRequest, token: vscode.CancellationToken) => {
            if (!request.continuous) {
                return startTestRun(request, token);
            }
        };

        this._runTestPlan = async (testPlan: string, commandContext: CommandContext) => {
            const request = new TestRunRequest(testPlan, commandContext);
            await runHandler(request, commandContext.cancellationToken);
        };

        const startTestRun = async (
            request: vscode.TestRunRequest,
            token: vscode.CancellationToken
        ) => {
            const queue: { test: vscode.TestItem; data: TestCase }[] = [];
            const run = ctrl.createTestRun(request, "iOS Tests", true);

            const discoverTests = async (tests: Iterable<vscode.TestItem>) => {
                for (const test of tests) {
                    if (request.exclude?.includes(test)) {
                        continue;
                    }

                    const data = this.context.testData.get(test);
                    if (data instanceof TestCase) {
                        run.enqueued(test);
                        queue.push({ test, data });
                    } else {
                        if (data instanceof TestFile && !data.didResolve) {
                            await data.updateFromDisk(ctrl, test);
                        } else if (data instanceof TestTarget && !data.didResolve) {
                            await data.updateFromDisk(ctrl, test);
                        } else if (data instanceof TestProject && !data.didResolve) {
                            await data.updateFromDisk(ctrl, test);
                        }

                        await discoverTests(this.gatherTestItems(test.children));
                    }
                }
            };

            const runTestQueue = async (context: CommandContext) => {
                const mapTests = new Map<string, { test: vscode.TestItem; data: TestCase }>();
                const xcodebuildTestsIds = new Set<string>();
                for (const { test, data } of queue) {
                    run.appendOutput(`Running ${test.id}\r\n`);
                    if (run.token.isCancellationRequested) {
                        run.skipped(test);
                    } else {
                        try {
                            run.started(test);
                            const xCodeBuildTest = data.getXCodeBuildTest();
                            const testId = data.getTestId();
                            xcodebuildTestsIds.add(xCodeBuildTest);
                            mapTests.set(testId, { test: test, data: data });
                        } catch (error) {
                            run.failed(test, { message: "Test Case was not well parsed" });
                            this.log.error(`Test was not correctly parsed: ${test}`);
                        }
                    }
                }

                try {
                    emptyTestsLog();
                    const rawParser = this.asyncParser.parseAsyncLogs(
                        context.debugConsoleEvent,
                        async (result, rawMessage, target, className, testName, duration) => {
                            const key = `${target}/${className}/${testName}()`;
                            const item = mapTests.get(key)?.test;
                            if (item) {
                                run.appendOutput(
                                    rawMessage.replaceAll("\n", "\n\r"),
                                    undefined,
                                    item
                                );
                                if (result === "passed") {
                                    run.passed(item, duration);
                                } else if (result === "failed") {
                                    const messages = await this.asyncTestCaseParser.parseAsyncLogs(
                                        rawMessage,
                                        item
                                    );
                                    run.failed(item, messages, duration);
                                }
                                mapTests.delete(key);
                            }
                        }
                    );
                    try {
                        // filter out all repetition tests
                        const testList = [...xcodebuildTestsIds.values()].filter(test => {
                            const component = test.split(path.sep);
                            for (let i = 1; i < component.length; ++i) {
                                const key = component.slice(0, i).join(path.sep);
                                if (xcodebuildTestsIds.has(key)) {
                                    return false;
                                }
                            }
                            return true;
                        });
                        await this.executeTests(
                            testList,
                            request.profile?.kind === vscode.TestRunProfileKind.Debug,
                            run,
                            context,
                            (request as TestRunRequest).testPlan,
                            request.profile?.kind === vscode.TestRunProfileKind.Coverage
                        );
                    } finally {
                        this.asyncParser.end(rawParser);
                    }
                } finally {
                    try {
                        await context.bundle.merge();
                        // read testing results
                        await this.extractTestingResults(context.bundle, mapTests, run);
                    } catch (error) {
                        this.log.error(`Error parsing test result logs: ${error}`);
                    } finally {
                        // all others are skipped
                        mapTests.forEach(item => {
                            run.skipped(item.test);
                        });
                        mapTests.clear();
                    }

                    try {
                        // read coverage results
                        const convergedFiles = await this.context.coverage.getCoverageFiles(
                            context.bundle
                        );
                        for (const file of convergedFiles) {
                            run.addCoverage(file);
                        }
                    } catch (error) {
                        this.log.error(`Coverage data can not be obtained: ${error}`);
                    }
                    // clean up build all target scheme if it was created
                    try {
                        const generatedSchemePath = context.projectEnv.buildScheme()?.path;
                        if (generatedSchemePath && fs.existsSync(generatedSchemePath)) {
                            fs.unlinkSync(generatedSchemePath);
                        }
                    } catch {
                        // ignore errors
                    }

                    run.end();
                }
            };
            // resolve all tree before start testing
            await this.findInitialFiles();
            await discoverTests(request.include ?? this.gatherTestItems(ctrl.items));
            const context = (request as TestRunRequest).context;
            const runner = async (context: CommandContext) => {
                if (token.isCancellationRequested) {
                    context.cancel();
                }
                const dis = token.onCancellationRequested(() => {
                    dis.dispose();
                    context.cancel();
                });
                try {
                    await runTestQueue(context);
                } catch (error) {
                    this.log.error(`${error}`);
                    throw error;
                }
            };
            if (context) {
                if (context.terminal) {
                    context.terminal.terminalName = "Start Testing";
                }
                await runner(context);
                return;
            }
            this.context?.atomicCommand
                .userCommand(async userContext => {
                    await runner(userContext);
                }, "Start Testing")
                .catch(() => {});
        };

        ctrl.refreshHandler = async () => {
            await this.findInitialFiles(true);
        };

        ctrl.createRunProfile(
            "Run Tests",
            vscode.TestRunProfileKind.Run,
            runHandler,
            true,
            undefined,
            false
        );
        ctrl.createRunProfile(
            "Debug Tests",
            vscode.TestRunProfileKind.Debug,
            runHandler,
            true,
            undefined,
            false
        );

        const coverageTestProfile = ctrl.createRunProfile(
            "Run with Coverage",
            vscode.TestRunProfileKind.Coverage,
            runHandler,
            true,
            undefined,
            false
        );
        coverageTestProfile.loadDetailedCoverage = async (_, coverage) => {
            return await this.context.coverage.getStatementCoverageFor(coverage);
        };

        ctrl.resolveHandler = async item => {
            if (!item) {
                await this.findInitialFiles();
                return;
            }

            const data = this.context.testData.get(item);
            if (data instanceof TestFile) {
                await data.updateFromDisk(ctrl, item);
            }
        };

        if (this.loadingState !== TestProviderLoadingState.loaded) {
            this.findInitialFiles();
        }

        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(e => {
                this.updateNodeForDocument(e);
            }),
            vscode.workspace.onDidChangeTextDocument(e => this.updateNodeForDocument(e.document))
        );
    }

    private async extractTestingResults(
        bundle: BundlePath,
        mapTests: Map<string, { test: vscode.TestItem; data: TestCase }>,
        run: vscode.TestRun
    ) {
        await this.context.testResult.enumerateTestsResults(
            key => {
                const item = mapTests.get(key)?.test;
                return item?.uri?.fsPath || key;
            },
            bundle,
            (key, result, rawMessage, messages, duration) => {
                const item = mapTests.get(key)?.test;
                if (item) {
                    run.appendOutput(rawMessage.replaceAll("\n", "\n\r"), undefined, item);
                    if (result === "passed") {
                        run.passed(item, duration);
                    } else if (result === "failed") {
                        run.failed(item, messages, duration);
                    }
                    mapTests.delete(key);
                }
            }
        );
    }

    supportedFileExtensions(file: string) {
        // sourcekit-lsp supports only swift file at the moment, we need to use workaround like legacy code parsing code for swift
        return file.endsWith(".swift"); // || file.endsWith(".m") || file.endsWith(".mm"));
    }

    async updateNodeForDocument(e: vscode.TextDocument) {
        if (e.uri.scheme !== "file") {
            return;
        }

        if (!this.supportedFileExtensions(e.uri.path)) {
            return;
        }

        const project = (await this.projectManager.getProjects()).at(0) || "";
        const target = (await this.projectManager.listTestTargetsForFile(e.uri.fsPath, project)).at(
            0
        );
        if (target === undefined || !this.projectManager.isTestTarget(target)) {
            return;
        }

        if (this.loadingState !== TestProviderLoadingState.loaded) {
            await this.findInitialFiles();
        }

        const { file, data } = this.context.getOrCreateTest("file://", e.uri, () => {
            return new TestFile(this.context, target);
        });
        const testFile = data as TestFile;
        await testFile.updateFromContents(this.context.ctrl, e.getText(), file);
        if ([...file.children].length === 0) {
            this.context.deleteItem(file.id);
        } else {
            this.context.addItem(file, root => {
                return (
                    root.id ===
                    TestTreeContext.TestID(
                        "target://",
                        TestTreeContext.getTargetFilePath(vscode.Uri.file(project), target)
                    )
                );
            });
        }
    }

    gatherTestItems(collection: vscode.TestItemCollection) {
        const items: vscode.TestItem[] = [];
        collection.forEach(item => items.push(item));
        return items;
    }

    initialize() {
        if (this.context.ctrl) {
            this.findInitialFiles();
        }
    }

    async findInitialFiles(forceUpdate = false) {
        const release = await this.initialFilesLoadingMutex.acquire();
        try {
            this.loadingState = TestProviderLoadingState.loading;
            await this.findInitialFilesIml(forceUpdate);
            this.loadingState = TestProviderLoadingState.loaded;
        } catch (err) {
            this.loadingState = TestProviderLoadingState.error;
            throw err;
        } finally {
            release();
        }
    }

    async findInitialFilesIml(forceUpdate: boolean) {
        if (forceUpdate) {
            this.context.clear();
        }
        for (const proj of await this.projectManager.getProjects()) {
            const url = proj;
            const { file, data } = this.context.getOrCreateTest(
                "project://",
                vscode.Uri.file(url),
                () => {
                    return new TestProject(
                        this.context,
                        async () => {
                            const targets = await this.projectManager.getProjectTargets();
                            return targets.filter(e => {
                                return this.projectManager.isTestTarget(e);
                            });
                        },
                        async targetName => {
                            const files = await this.projectManager.getFilesForTarget(targetName);
                            return files.filter(e => {
                                return this.supportedFileExtensions(e);
                            });
                        }
                    );
                }
            );
            if (!data.didResolve || forceUpdate) {
                await data.updateFromDisk(this.context.ctrl, file);
            }
            break; // only first target
        }
        return;
    }
}
