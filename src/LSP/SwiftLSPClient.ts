import * as langclient from "vscode-languageclient/node";
import * as vscode from "vscode";
import { SourceKitLSPErrorHandler } from "./SourceKitLSPErrorHandler";
import path from "path";
import { uriConverters } from "./uriConverters";
import { XCRunHelper } from "../Tools/XCRunHelper";
import { WorkspaceContext } from "./WorkspaceContext";
import { ProblemDiagnosticResolver } from "../ProblemDiagnosticResolver";
import { activatePeekDocuments } from "./peekDocuments";
import { activateGetReferenceDocument } from "./getReferenceDocument";

export class SwiftLSPClient {
    private languageClient: langclient.LanguageClient | null | undefined;

    private clientReadyPromise?: Promise<void> = undefined;
    private peekDocuments?: vscode.Disposable;
    private getReferenceDocument?: vscode.Disposable;

    public async client(): Promise<langclient.LanguageClient> {
        if (this.languageClient === undefined) {
            if (this.clientReadyPromise === undefined) {
                await this.setupLanguageClient(this.workspaceContext.workspaceFolder);
            }
            await this.clientReadyPromise;
        }
        return this.languageClient!;
    }

    constructor(
        private readonly workspaceContext: WorkspaceContext,
        private readonly logs: vscode.OutputChannel
    ) {}

    public async start() {
        await this.client();
    }

    public async restart() {
        this.peekDocuments?.dispose();
        this.peekDocuments = undefined;
        this.getReferenceDocument?.dispose();
        this.getReferenceDocument = undefined;
        const client = await this.client();
        this.clientReadyPromise = undefined;
        this.languageClient = undefined;
        try {
            client.stop();
            client.dispose();
            // start it again
            await this.start();
        } catch (error) {
            this.logs.appendLine(`${error}`);
            if (error instanceof Error && error.message === "Stopping the server timed out") {
                await this.start(); // start a new one
            }
        }
    }

    private async setupLanguageClient(folder?: vscode.Uri) {
        const { client, errorHandler } = await this.createLSPClient(folder);
        return this.startClient(client, errorHandler);
    }

    private async createLSPClient(folder?: vscode.Uri): Promise<{
        client: langclient.LanguageClient;
        errorHandler: SourceKitLSPErrorHandler;
    }> {
        const serverPath = await XCRunHelper.sourcekitLSPPath();
        const sourcekit: langclient.Executable = {
            command: serverPath,
            args: [],
            options: {
                env: {
                    ...process.env,
                    XXX_BUILD_SERVER_KIT: "/SERVE",
                    // SOURCEKIT_LOGGING: 3, // for DEBUG PURPOSES
                    SOURCEKIT_TOOLCHAIN_PATH: await XCRunHelper.swiftToolchainPath(),
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
            // at the moment it's empty, as it's should not be active, only used for tests parsing at the moment
            documentSelector: [
                { scheme: "sourcekit-lsp", language: "swift" },
                { scheme: "file", language: "swift" },
                { scheme: "untitled", language: "swift" },
                { scheme: "file", language: "objective-c" },
                { scheme: "untitled", language: "objective-c" },
                { scheme: "file", language: "objective-cpp" },
                { scheme: "untitled", language: "objective-cpp" },
                // C family
                { scheme: "file", language: "c" },
                { scheme: "untitled", language: "c" },
                { scheme: "file", language: "cpp" },
                { scheme: "untitled", language: "cpp" },
            ],
            revealOutputChannelOn: langclient.RevealOutputChannelOn.Never,
            workspaceFolder: workspaceFolder,
            outputChannel: this.logs,
            middleware: {
                provideDocumentSymbols: async (document, token, next) => {
                    try {
                        const result = await next(document, token);
                        // const documentSymbols = result as vscode.DocumentSymbol[];
                        return result;
                    } catch (error) {
                        return [];
                    }
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
                    this.workspaceContext.problemDiagnosticResolver.handleDiagnostics(
                        document.uri ?? uri,
                        ProblemDiagnosticResolver.isSourcekit,
                        result?.items ?? []
                    );
                    return undefined;
                },
                handleDiagnostics: (uri, diagnostics) => {
                    this.workspaceContext.problemDiagnosticResolver.handleDiagnostics(
                        uri,
                        ProblemDiagnosticResolver.isSourcekit,
                        diagnostics
                    );
                },
                handleWorkDoneProgress: (() => {
                    // const lastPrompted = new Date(0).getTime();
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
            initializationFailedHandler: () => false,
            initializationOptions: this.initializationOptions(),
        };

        return {
            client: new langclient.LanguageClient(
                "xcode.sourcekit-lsp",
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
        client.onDidChangeState(() => {
            // TODO: for nuw on is empty
        });

        // start client
        this.clientReadyPromise = client
            .start()
            .then(() => {
                // Now that we've started up correctly, start the error handler to auto-restart
                // if sourcekit-lsp crashes during normal operation.
                errorHandler.enable();

                this.peekDocuments = activatePeekDocuments(client);
                this.getReferenceDocument = activateGetReferenceDocument(client);
            })
            .catch(reason => {
                this.logs.appendLine(`${reason}`);
                this.languageClient?.stop();
                this.languageClient = undefined;
                throw reason;
            });

        this.languageClient = client;

        return this.clientReadyPromise;
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    private initializationOptions(): any {
        const options: any = {
            "workspace/peekDocuments": true, // workaround for client capability to handle `PeekDocumentsRequest`
            "workspace/getReferenceDocument": true, // the client can handle URIs with scheme `sourcekit-lsp:`
            "textDocument/codeLens": {
                supportedCommands: {
                    "swift.run": "swift.run",
                    "swift.debug": "swift.debug",
                },
            },
        };

        // if (configuration.backgroundIndexing) {
        //     options = {
        //         ...options,
        //         backgroundIndexing: configuration.backgroundIndexing,
        //         backgroundPreparationMode: "enabled",
        //     };
        // }
        return options;
    }
}
