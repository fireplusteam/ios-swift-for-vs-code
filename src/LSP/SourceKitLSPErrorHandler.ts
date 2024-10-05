import * as langclient from "vscode-languageclient/node";
import * as vscode from "vscode";

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