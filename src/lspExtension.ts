import * as ls from "vscode-languageserver-protocol";
import * as langclient from "vscode-languageclient/node";
import * as vscode from "vscode";
import path from "path";

class LanExt {

    private languageClient: langclient.LanguageClient | null | undefined;

    private clientReadyPromise?: Promise<void>;

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
            documentSelector: LanguageClientManager.documentSelector,
            revealOutputChannelOn: langclient.RevealOutputChannelOn.Never,
            workspaceFolder: workspaceFolder,
            outputChannel: new SwiftOutputChannel("SourceKit Language Server", false),
            middleware: {
                provideDocumentSymbols: async (document, token, next) => {
                    const result = await next(document, token);
                    const documentSymbols = result as vscode.DocumentSymbol[];
                    if (this.documentSymbolWatcher && documentSymbols) {
                        this.documentSymbolWatcher(document, documentSymbols);
                    }
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
                    // remove textEdits for swift version earlier than 5.10 as it sometimes
                    // generated invalid textEdits
                    if (this.workspaceContext.swiftVersion.isLessThan(new Version(5, 10, 0))) {
                        result?.forEach(r => (r.textEdits = undefined));
                    }
                    return result;
                },
                provideDiagnostics: async (uri, previousResultId, token, next) => {
                    const result = await next(uri, previousResultId, token);
                    if (result?.kind === langclient.vsdiag.DocumentDiagnosticReportKind.unChanged) {
                        return undefined;
                    }
                    const document = uri as vscode.TextDocument;
                    this.workspaceContext.diagnostics.handleDiagnostics(
                        document.uri ?? uri,
                        DiagnosticsManager.isSourcekit,
                        result?.items ?? []
                    );
                    return undefined;
                },
                handleDiagnostics: (uri, diagnostics) => {
                    this.workspaceContext.diagnostics.handleDiagnostics(
                        uri,
                        DiagnosticsManager.isSourcekit,
                        diagnostics
                    );
                },
                handleWorkDoneProgress: (() => {
                    let lastPrompted = new Date(0).getTime();
                    return async (token, params, next) => {
                        const result = await next(token, params);
                        const now = new Date().getTime();
                        const oneHour = 60 * 60 * 1000;
                        if (
                            now - lastPrompted > oneHour &&
                            token.toString().startsWith("sourcekitd-crashed")
                        ) {
                            // Only prompt once an hour in case sourcekit is in a crash loop
                            lastPrompted = now;
                            promptForDiagnostics(this.workspaceContext);
                        }
                        return result;
                    };
                })(),
            },
            uriConverters,
            errorHandler,
            // Avoid attempting to reinitialize multiple times. If we fail to initialize
            // we aren't doing anything different the second time and so will fail again.
            initializationFailedHandler: () => false,
            initializationOptions: this.initializationOptions(),
        };

        return {
            client: new langclient.LanguageClient(
                "swift.sourcekit-lsp",
                "SourceKit Language Server",
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
                this.addSubFolderWorkspaces(client);
            }
        });
        if (client.clientOptions.workspaceFolder) {
            this.workspaceContext.outputChannel.log(
                `SourceKit-LSP setup for ${FolderContext.uriName(
                    client.clientOptions.workspaceFolder.uri
                )}`
            );
        } else {
            this.workspaceContext.outputChannel.log(`SourceKit-LSP setup`);
        }

        client.onNotification(langclient.LogMessageNotification.type, params => {
            console.log("error");
            // this.logMessage(client, params as SourceKitLogMessageParams);
        });

        // start client
        this.clientReadyPromise = client
            .start()
            .then(() => {
                // Now that we've started up correctly, start the error handler to auto-restart
                // if sourcekit-lsp crashes during normal operation.
                errorHandler.enable();

                if (this.workspaceContext.swiftVersion.isLessThan(new Version(5, 7, 0))) {
                    this.legacyInlayHints = activateLegacyInlayHints(client);
                }

                this.peekDocuments = activatePeekDocuments(client);
                this.getReferenceDocument = activateGetReferenceDocument(client);
                this.workspaceContext.subscriptions.push(this.getReferenceDocument);
            })
            .catch(reason => {
                this.workspaceContext.outputChannel.log(`${reason}`);
                this.languageClient?.stop();
                this.languageClient = undefined;
                throw reason;
            });

        this.languageClient = client;
        this.cancellationToken = new vscode.CancellationTokenSource();

        return this.clientReadyPromise;
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
