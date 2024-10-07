import * as vscode from 'vscode';
import { TestFile } from './TestItemProvider/TestFile';
import { TestCase } from './TestItemProvider/TestCase';
import { TestProject } from './TestItemProvider/TestProject';
import { ProjectManager } from '../ProjectManager/ProjectManager';
import { TestTarget } from './TestItemProvider/TestTarget';
import { emptyTestsLog } from '../utils';
import { TestCaseAsyncParser } from './RawLogParsers/TestCaseAsyncParser';
import { getWorkspacePath } from '../env';
import { TestTreeContext } from './TestTreeContext';
import { TestCaseProblemParser } from './RawLogParsers/TestCaseProblemParser';
import { error } from 'console';

enum TestProviderLoadingState {
    nonInitialised,
    loading,
    loaded,
    error
}

export class TestProvider {
    projectManager: ProjectManager
    executeTests: (tests: string[] | undefined, isDebuggable: boolean, testRun: vscode.TestRun) => Promise<boolean>;
    context: TestTreeContext;
    asyncParser = new TestCaseAsyncParser()
    asyncTestCaseParser = new TestCaseProblemParser();

    private loadingState: TestProviderLoadingState = TestProviderLoadingState.nonInitialised;
    private initialFilesLoadingPromise = Promise.resolve();

    constructor(projectManager: ProjectManager, context: TestTreeContext, executeTests: (tests: string[] | undefined, isDebuggable: boolean, testRun: vscode.TestRun) => Promise<boolean>) {
        this.projectManager = projectManager;
        this.context = context;
        this.executeTests = executeTests;
    }

    activateTests(context: vscode.ExtensionContext) {
        const ctrl = this.context.ctrl;
        context.subscriptions.push(ctrl);

        const runHandler = (request: vscode.TestRunRequest, cancellation: vscode.CancellationToken) => {
            if (!request.continuous) {
                return startTestRun(request);
            }
        };

        const startTestRun = async (request: vscode.TestRunRequest) => {
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

            const runTestQueue = async () => {
                const mapTests = new Map<string, { test: vscode.TestItem, data: TestCase }>();
                const xcodebuildTestsIds: string[] = [];
                for (const { test, data } of queue) {
                    run.appendOutput(`Running ${test.id}\r\n`);
                    if (run.token.isCancellationRequested) {
                        run.skipped(test);
                    } else {
                        try {
                            run.started(test);
                            const xCodeBuildTest = data.getXCodeBuildTest();
                            const testId = data.getTestId();
                            xcodebuildTestsIds.push(xCodeBuildTest);
                            mapTests.set(
                                testId,
                                { test: test, data: data }
                            );
                        } catch (error) {
                            run.failed(test, { message: "Test Case was not well parsed" });
                            console.error(`Test was not correctly parsed: ${test}`);
                        }
                    }
                }

                try {
                    emptyTestsLog();
                    this.asyncParser.parseAsyncLogs(
                        getWorkspacePath(),
                        ".logs/tests.log",
                        async (result, rawMessage, target, className, testName, duration) => {
                            const key = `${target}/${className}/${testName}()`;
                            const item = mapTests.get(key)?.test;
                            if (item) {
                                run.appendOutput(rawMessage.replaceAll("\n", "\n\r"), undefined, item);
                                if (result === "passed") {
                                    run.passed(item, duration);
                                } else if (result == "failed") {
                                    const messages = await this.asyncTestCaseParser.parseAsyncLogs(rawMessage, item);
                                    run.failed(item, messages, duration);
                                }
                                mapTests.delete(key);
                            }
                            console.log("log");
                        });
                    try {
                        await this.executeTests(request.include === undefined ? undefined : xcodebuildTestsIds, request.profile?.kind === vscode.TestRunProfileKind.Debug, run);
                    } finally {
                        await this.context.testResult.enumerateTestsResults((key) => {
                            const item = mapTests.get(key)?.test;
                            return item?.uri?.fsPath || key;
                        }, (key, result, rawMessage, messages, duration) => {
                            const item = mapTests.get(key)?.test;
                            if (item) {
                                run.appendOutput(rawMessage.replaceAll("\n", "\n\r"), undefined, item);
                                if (result === "passed") {
                                    run.passed(item, duration);
                                } else if (result == "failed") {
                                    run.failed(item, messages, duration);
                                }
                                mapTests.delete(key);
                            }
                        });
                    }
                }
                catch (err) {
                    console.log(`Run with error: ${err}`);
                } finally {
                    try {
                        const convergedFiles = await this.context.coverage.getCoverageFiles();
                        for (const file of convergedFiles)
                            run.addCoverage(file);
                    } catch {
                        console.error(`Coverage data can not be obtained: ${error.toString()}`);
                    }

                    run.end();
                }
            };
            // resolve all tree before start testing
            await this.findInitialFiles(this.context.ctrl);
            await discoverTests(request.include ?? this.gatherTestItems(ctrl.items)).then(runTestQueue);
        };

        ctrl.refreshHandler = async () => {
            await this.findInitialFiles(ctrl)
        };

        ctrl.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, runHandler, true, undefined, false);
        ctrl.createRunProfile('Debug Tests', vscode.TestRunProfileKind.Debug, runHandler, true, undefined, false);

        const coverageTestProfile = ctrl.createRunProfile('Run with Coverage', vscode.TestRunProfileKind.Coverage, runHandler, true, undefined, false);
        coverageTestProfile.loadDetailedCoverage = async (_, coverage) => {
            return await this.context.coverage.getStatementCoverageFor(coverage);
        };

        ctrl.resolveHandler = async item => {
            if (!item) {
                await this.findInitialFiles(ctrl);
                return;
            }

            const data = this.context.testData.get(item);
            if (data instanceof TestFile) {
                await data.updateFromDisk(ctrl, item);
            }
        };

        for (const document of vscode.workspace.textDocuments) {
            this.updateNodeForDocument(document, ctrl);
        }

        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(e => { this.updateNodeForDocument(e, ctrl) }),
            vscode.workspace.onDidChangeTextDocument(e => this.updateNodeForDocument(e.document, ctrl)),
        );
    }

    async updateNodeForDocument(e: vscode.TextDocument, ctrl: vscode.TestController) {
        if (e.uri.scheme !== 'file') {
            return;
        }

        if (!e.uri.path.endsWith('.swift')) {
            return;
        }

        if (this.loadingState != TestProviderLoadingState.loaded)
            await this.findInitialFiles(this.context.ctrl);

        const targets = await this.projectManager.listTargetsForFile(e.uri.fsPath);
        const { file, data } = this.context.getOrCreateTest("file://", e.uri, () => {
            return new TestFile(this.context, targets[0]);
        });
        const testFile = data as TestFile;
        await testFile.updateFromContents(this.context.ctrl, e.getText(), file);
        if ([...file.children].length == 0) {
            this.context.deleteItem(file.id);
        }
        else {
            const project = (await this.projectManager.getProjects()).at(0) || "";
            this.context.addItem(file, root => {
                return root.id === TestTreeContext.TestID("target://", TestTreeContext.getTargetFilePath(vscode.Uri.file(project), targets[0]));
            });
        }
    }

    gatherTestItems(collection: vscode.TestItemCollection) {
        const items: vscode.TestItem[] = [];
        collection.forEach(item => items.push(item));
        return items;
    }

    initialize() {
        if (this.context.ctrl)
            this.findInitialFiles(this.context.ctrl);
    }

    async findInitialFiles(controller: vscode.TestController) {
        if (this.loadingState == TestProviderLoadingState.loading) {
            return this.initialFilesLoadingPromise;
        }
        try {
            this.loadingState = TestProviderLoadingState.loading;
            this.initialFilesLoadingPromise = this.findInitialFilesIml(controller);
            await this.initialFilesLoadingPromise;
            this.loadingState = TestProviderLoadingState.loaded;
        } catch (err) {
            this.loadingState = TestProviderLoadingState.error;
            throw err;
        }
    }

    async findInitialFilesIml(controller: vscode.TestController) {
        for (const proj of await this.projectManager.getProjects()) {
            const url = proj;
            const { file, data } = this.context.getOrCreateTest(
                "project://",
                vscode.Uri.file(url),
                () => {
                    return new TestProject(this.context,
                        async () => {
                            const targets = await this.projectManager.getProjectTargets();
                            return targets.filter(e => { return e.includes("Tests") });
                        }, async (targetName) => {
                            const files = await this.projectManager.getFilesForTarget(targetName);
                            return files.filter(e => { return e.endsWith(".swift") });
                        });
                }
            );
            if (!data.didResolve) {
                await data.updateFromDisk(controller, file);
            }
            break; // only first target 
        }
        return;
    }
}


