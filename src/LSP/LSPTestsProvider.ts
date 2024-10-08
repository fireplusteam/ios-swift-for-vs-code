import * as vscode from "vscode";
import { LSPTestItem, textDocumentTestsRequest } from "./lspExtension";
import { SwiftLSPClient } from "./SwiftLSPClient";
import * as lp from "vscode-languageserver-protocol";

export class LSPTestsProvider {
    private version = 0;

    constructor(private lspClient: SwiftLSPClient) {}

    private languageId(file: string) {
        if (file.endsWith(".swift")) {
            return "swift";
        }
        if (file.endsWith(".m")) {
            return "objective-c";
        }
        if (file.endsWith(".mm")) {
            return "objective-cpp";
        }
    }

    async fetchTests(document: vscode.Uri, content: string): Promise<LSPTestItem[]> {
        this.version++;
        // TODO: if you decide to implement you full support of lsp support for all the features and get rid of official Swift extension, then the next line should be uncommented
        // until then leave it commented, as this lsp client is used only for test parser
        // document = vscode.Uri.file(document.fsPath + "_f"); // create a fake file, it's used just for lexical parsing of test location
        console.log(`FETCHING TESTS FOR URL: ${document.toString()}`);

        const client = await this.lspClient.client();
        const languageId = this.languageId(document.fsPath);
        if (languageId === undefined) {
            return [];
        }

        const didOpenParam: lp.DidOpenTextDocumentParams = {
            textDocument: {
                uri: document.toString(),
                languageId: languageId,
                text: content,
                version: this.version,
            },
        };

        await client.sendNotification(lp.DidOpenTextDocumentNotification.method, didOpenParam);

        try {
            const testsInDocument = await (
                await this.lspClient.client()
            ).sendRequest(textDocumentTestsRequest, { textDocument: { uri: document.toString() } });
            return testsInDocument;
        } finally {
            const didCloseParam: lp.DidCloseTextDocumentParams = {
                textDocument: { uri: document.toString() },
            };

            await client.sendNotification(
                lp.DidCloseTextDocumentNotification.method,
                didCloseParam
            );
        }
    }
}
