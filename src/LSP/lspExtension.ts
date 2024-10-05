import * as ls from "vscode-languageserver-protocol";
import * as langclient from "vscode-languageclient/node";
import * as vscode from "vscode";
import path from "path";
import { getWorkspaceFolder, getWorkspacePath } from "../env";
import { sleep } from "../extension";
import { uriConverters } from "./uriConverters";

// Test styles where test-target represents a test target that contains tests
export type TestStyle = "XCTest" | "swift-testing" | "test-target";

export interface LSPTestItem {
    /**
     * This identifier uniquely identifies the test case or test suite. It can be used to run an individual test (suite).
     */
    id: string;

    /**
     * Display name describing the test.
     */
    label: string;

    /**
     * Optional description that appears next to the label.
     */
    description?: string;

    /**
     * A string that should be used when comparing this item with other items.
     *
     * When `undefined` the `label` is used.
     */
    sortText?: string;

    /**
     *  Whether the test is disabled.
     */
    disabled: boolean;

    /**
     * The type of test, eg. the testing framework that was used to declare the test.
     */
    style: TestStyle;

    /**
     * The location of the test item in the source code.
     */
    location: ls.Location;

    /**
     * The children of this test item.
     *
     * For a test suite, this may contain the individual test cases or nested suites.
     */
    children: LSPTestItem[];

    /**
     * Tags associated with this test item.
     */
    tags: { id: string }[];
}

interface DocumentTestsParams {
    textDocument: {
        uri: ls.URI;
    };
}

export const textDocumentTestsRequest = new langclient.RequestType<
    DocumentTestsParams,
    LSPTestItem[],
    unknown
>("textDocument/tests");

export class SwiftLSPClient {

    private languageClient: langclient.LanguageClient | null | undefined;

    private clientReadyPromise?: Promise<void>;

    constructor() {
        this.setupLanguageClient(getWorkspaceFolder())
    }

    private async setupLanguageClient(folder?: vscode.Uri) {
        const { client, errorHandler } = this.createLSPClient(folder);
        return this.startClient(client, errorHandler);
    }

    private createLSPClient(folder?: vscode.Uri): {
        client: langclient.LanguageClient;
        errorHandler: SourceKitLSPErrorHandler;
    } {
        const serverPath =
            "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/sourcekit-lsp";
        const sourcekit: langclient.Executable = {
            command: serverPath,
            args: [],
            options: {
                env: {
                    ...process.env,
                    SOURCEKIT_LOGGING: 3,
                    SOURCEKIT_TOOLCHAIN_PATH: "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain"
                },
            },
        };


        const serverOptions: langclient.ServerOptions = sourcekit;
        let workspaceFolder = undefined;
        if (folder) {
            workspaceFolder = { uri: folder, name: path.basename(folder.fsPath), index: 0 };
        }

        const errorHandler = new SourceKitLSPErrorHandler(5);
        const clientOptions: langclient.LanguageClientOptions = {
            documentSelector: [
                { scheme: "sourcekit-lsp", language: "swift" },
                { scheme: "file", language: "swift" },
                { scheme: "untitled", language: "swift" },
                { scheme: "file", language: "objective-c" },
                { scheme: "untitled", language: "objective-c" },
                { scheme: "file", language: "objective-cpp" },
                { scheme: "untitled", language: "objective-cpp" },
            ],
            revealOutputChannelOn: langclient.RevealOutputChannelOn.Never,
            workspaceFolder: workspaceFolder,
            outputChannel: new SwiftOutputChannel(),
            middleware: {
                provideDocumentSymbols: async (document, token, next) => {
                    const result = await next(document, token);
                    const documentSymbols = result as vscode.DocumentSymbol[];
                    const tests = this.fetchTests(document.uri);
                    return result;
                },
                provideDefinition: async (document, position, token, next) => {
                    const result = await next(document, position, token);
                    const definitions = result as vscode.Location[];
                    if (
                        definitions &&
                        path.extname(definitions[0].uri.path) === ".swiftinterface"
                    ) {
                        const uri = definitions[0].uri.with({ scheme: "readonly" });
                        return new vscode.Location(uri, definitions[0].range);
                    }
                    return result;
                },
                // temporarily remove text edit from Inlay hints while SourceKit-LSP
                // returns invalid replacement text
                provideInlayHints: async (document, position, token, next) => {
                    const result = await next(document, position, token);
                    return result;
                },
                provideDiagnostics: async (uri, previousResultId, token, next) => {
                    const result = await next(uri, previousResultId, token);
                    if (result?.kind === langclient.vsdiag.DocumentDiagnosticReportKind.unChanged) {
                        return undefined;
                    }
                    const document = uri as vscode.TextDocument;
                    return undefined;
                },
                handleDiagnostics: (uri, diagnostics) => {
                    console.log("fdf");
                },
                handleWorkDoneProgress: (() => {
                    let lastPrompted = new Date(0).getTime();
                    return async (token, params, next) => {
                        const result = await next(token, params);
                        return result;
                    };
                })(),
            },
            uriConverters: uriConverters,
            errorHandler: errorHandler,
            // Avoid attempting to reinitialize multiple times. If we fail to initialize
            // we aren't doing anything different the second time and so will fail again.
            initializationFailedHandler: () => false
        };

        return {
            client: new langclient.LanguageClient(
                "sourcekit-lsp",
                "Xcode SourceKit Language Server",
                serverOptions,
                clientOptions
            ),
            errorHandler,
        };
    }

    private async startClient(
        client: langclient.LanguageClient,
        errorHandler: SourceKitLSPErrorHandler
    ) {
        client.onDidChangeState(e => {
            // if state is now running add in any sub-folder workspaces that
            // we have cached. If this is the first time we are starting then
            // we won't have any sub folder workspaces, but if the server crashed
            // or we forced a restart then we need to do this
            if (
                e.oldState === langclient.State.Starting &&
                e.newState === langclient.State.Running
            ) {
                // this.addSubFolderWorkspaces(client);
            }
        });

        client.onNotification(langclient.LogMessageNotification.type, params => {
            console.log("error");
            // this.logMessage(client, params as SourceKitLogMessageParams);
        });
        client.onNotification(langclient.LogMessageNotification.method, e => {
            console.log("error");
        });

        // start client
        this.clientReadyPromise = client
            .start()
            .then(() => {
                // Now that we've started up correctly, start the error handler to auto-restart
                // if sourcekit-lsp crashes during normal operation.
                errorHandler.enable();
            })
            .catch(reason => {
                this.languageClient?.stop();
                this.languageClient = undefined;
                throw reason;
            });

        this.languageClient = client;

        return this.clientReadyPromise;
    }

    async fetchTests(document: vscode.Uri) {
        if (this.languageClient == undefined) {
            await this.clientReadyPromise;
        }
        if (this.languageClient == undefined) return;
        try {
            const testsInDocument = await this.languageClient.sendRequest(
                textDocumentTestsRequest,
                { textDocument: { uri: document.toString() } }
            );
            console.log(testsInDocument);
        }
        catch (error) {
            console.log(error);
            this.fetchTests(document);
        }
    }
}

export class SwiftOutputChannel implements vscode.OutputChannel {
    name: string = "Xcode Swift LSP";

    append(value: string): void {
        console.log(`${this.name}: ${value}`);
    }

    appendLine(value: string): void {
        console.log(`${this.name}: ${value}`);
    }

    replace(value: string): void {
        console.log(`${this.name} replace: ${value}`);
    }


    clear(): void {
    }

    show(column?: unknown, preserveFocus?: unknown): void {
    }

    hide(): void {
    }

    dispose(): void {
    }
}


/**
 * SourceKit-LSP error handler. Copy of the default error handler, except it includes
 * an error message that asks if you want to restart the sourcekit-lsp server again
 * after so many crashes
 */
export class SourceKitLSPErrorHandler implements langclient.ErrorHandler {
    private restarts: number[];
    private enabled: boolean = false;

    constructor(private maxRestartCount: number) {
        this.restarts = [];
    }
    /**
     * Start listening for errors and requesting to restart the LSP server when appropriate.
     */
    enable() {
        this.enabled = true;
    }
    /**
     * An error has occurred while writing or reading from the connection.
     *
     * @param error - the error received
     * @param message - the message to be delivered to the server if know.
     * @param count - a count indicating how often an error is received. Will
     *  be reset if a message got successfully send or received.
     */
    error(
        error: Error,
        message: langclient.Message | undefined,
        count: number | undefined
    ): langclient.ErrorHandlerResult | Promise<langclient.ErrorHandlerResult> {
        if (count && count <= 3) {
            return { action: langclient.ErrorAction.Continue };
        }
        return { action: langclient.ErrorAction.Shutdown };
    }
    /**
     * The connection to the server got closed.
     */
    closed(): langclient.CloseHandlerResult | Promise<langclient.CloseHandlerResult> {
        if (!this.enabled) {
            return {
                action: langclient.CloseAction.DoNotRestart,
                handled: true,
            };
        }

        this.restarts.push(Date.now());
        if (this.restarts.length <= this.maxRestartCount) {
            return { action: langclient.CloseAction.Restart };
        } else {
            const diff = this.restarts[this.restarts.length - 1] - this.restarts[0];
            if (diff <= 3 * 60 * 1000) {
                return new Promise<langclient.CloseHandlerResult>(resolve => {
                    vscode.window
                        .showErrorMessage(
                            `The SourceKit-LSP server crashed ${this.maxRestartCount + 1
                            } times in the last 3 minutes. See the output for more information. Do you want to restart it again.`,
                            "Yes",
                            "No"
                        )
                        .then(result => {
                            if (result === "Yes") {
                                this.restarts = [];
                                resolve({ action: langclient.CloseAction.Restart });
                            } else {
                                resolve({ action: langclient.CloseAction.DoNotRestart });
                            }
                        });
                });
            } else {
                this.restarts.shift();
                return { action: langclient.CloseAction.Restart };
            }
        }
    }
}

/** Language client errors */
export enum LanguageClientError {
    LanguageClientUnavailable,
}
