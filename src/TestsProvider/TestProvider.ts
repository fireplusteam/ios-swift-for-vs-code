import * as vscode from 'vscode';
import { TestFile } from './TestFile';
import { TestCase } from './TestCase';
import { TestProject } from './TestProject';
import { ProjectManager } from '../ProjectManager/ProjectManager';
import { TestTarget } from './TestTarget';
import { emptyTestsLog } from '../utils';
import { TestCaseAsyncParser } from './TestCaseAsyncParser';
import { getWorkspacePath } from '../env';
import { TestTreeContext } from './TestTreeContext';
import { TestCaseProblemParser } from './TestCaseProblemParser';
import { error } from 'console';

export class TestProvider {
    projectManager: ProjectManager
    executeTests: (tests: string[] | undefined, isDebuggable: boolean) => Promise<boolean>;
    context = new TestTreeContext();
    asyncParser = new TestCaseAsyncParser()
    asyncTestCaseParser = new TestCaseProblemParser();

    constructor(projectManager: ProjectManager, executeTests: (tests: string[] | undefined, isDebuggable: boolean) => Promise<boolean>) {
        this.projectManager = projectManager;
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
                const tests: string[] = [];
                for (const { test, data } of queue) {
                    run.appendOutput(`Running ${test.id}\r\n`);
                    if (run.token.isCancellationRequested) {
                        run.skipped(test);
                    } else {
                        run.started(test);
                        tests.push(data.getXCodeBuildTest(test));
                        mapTests.set(
                            data.getXCodeBuildTest(test),
                            { test: test, data: data }
                        );
                    }
                }

                try {
                    emptyTestsLog();
                    this.asyncParser.parseAsyncLogs(
                        getWorkspacePath(),
                        ".logs/tests.log",
                        async (result, rawMessage, target, className, testName, duration) => {
                            const key = `${target}/${className}/${testName}`;
                            const item = mapTests.get(key)?.test;
                            if (item) {
                                run.appendOutput(rawMessage.replaceAll("\n", "\n\r"), undefined, item);
                                if (result === "passed") {
                                    run.passed(item, duration);
                                } else if (result == "failed") {
                                    const messages = await this.asyncTestCaseParser.parseAsyncLogs(rawMessage, item);
                                    run.failed(item, messages, duration);
                                }
                            }
                            console.log("log");
                        });
                    await this.executeTests(request.include === undefined ? undefined : tests, request.profile?.kind === vscode.TestRunProfileKind.Debug);
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
            discoverTests(request.include ?? this.gatherTestItems(ctrl.items)).then(runTestQueue);
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
                this.findInitialFiles(ctrl);
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

        const { file, data } = this.context.getOrCreateTest(e.uri, () => {
            return new TestFile(this.context);
        });
        const testFile = data as TestFile;
        await testFile.updateFromContents(this.context.ctrl, e.getText(), file);
        if ([...file.children].length == 0) {
            this.context.deleteItem(file.id);
        }
        else {
            const targets = await this.projectManager.listTargetsForFile(e.uri.fsPath);
            const project = (await this.projectManager.getProjects()).at(0);
            this.context.addItem(file, root => {
                return root.uri?.path === `/${project}/${targets[0]}`;
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
        for (const proj of await this.projectManager.getProjects()) {
            const url = proj;
            const { file, data } = this.context.getOrCreateTest(
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


