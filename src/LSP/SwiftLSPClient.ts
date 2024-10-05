import * as langclient from "vscode-languageclient/node"
import * as vscode from "vscode"
import { getWorkspaceFolder } from "../env";
import { SourceKitLSPErrorHandler } from "./SourceKitLSPErrorHandler";
import path from "path";
import { uriConverters } from "./uriConverters";
import { textDocumentTestsRequest } from "./lspExtension";
import { SwiftOutputChannel } from "./SwiftOutputChannel";

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
                    return [];
                    const result = await next(document, token);
                    const documentSymbols = result as vscode.DocumentSymbol[];
                    const tests = this.fetchTests(document.uri);
                    return result;
                },
                provideDefinition: async (document, position, token, next) => {
                    return [];
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
                    return [];
                    const result = await next(document, position, token);
                    return result;
                },
                provideDiagnostics: async (uri, previousResultId, token, next) => {
                    return undefined;
                    const result = await next(uri, previousResultId, token);
                    if (result?.kind === langclient.vsdiag.DocumentDiagnosticReportKind.unChanged) {
                        return undefined;
                    }
                    const document = uri as vscode.TextDocument;
                    return undefined;
                },
                handleDiagnostics: (uri, diagnostics) => {
                    return () => {
                    }
                },
                handleWorkDoneProgress: (() => {
                    return () => {
                        return;
                    }
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
            return testsInDocument;
        }
        catch (error) {
            console.log(error);
            this.fetchTests(document);
        }
    }
}