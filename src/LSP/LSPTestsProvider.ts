import * as vscode from "vscode"
import { LSPTestItem, textDocumentTestsRequest } from "./lspExtension";
import { SwiftLSPClient } from "./SwiftLSPClient";
import * as lp from "vscode-languageserver-protocol";
import * as fs from 'fs';

export class LSPTestsProvider {

    constructor(private lspClient: SwiftLSPClient) {
    }

    async fetchTests(document: vscode.Uri): Promise<LSPTestItem[]> {
        try {
            const content = fs.readFileSync(document.fsPath).toString();
            // TODO: if you decide to implement you full support of lsp support for all the features and get rid of official Swift extension, then the next line should be uncommented
            // until then leave it commented, as this lsp client is used only for test parser
            // document = vscode.Uri.file(document.fsPath + "_f"); // create a fake file, it's used just for lexical parsing of test location
            console.log(`FETCHING TESTS FOR URL: ${document.toString()}`);

            const client = await this.lspClient.client();

            const didOpenParam: lp.DidOpenTextDocumentParams = {
                textDocument: { uri: document.toString(), languageId: "swift", text: content, version: 1 }
            };

            await client.sendNotification(lp.DidOpenTextDocumentNotification.method, didOpenParam);

            try {
                const testsInDocument = await (await this.lspClient.client()).sendRequest(
                    textDocumentTestsRequest,
                    { textDocument: { uri: document.toString() } }
                );
                return testsInDocument;
            } finally {
                const didCloseParam: lp.DidCloseTextDocumentParams = {
                    textDocument: { uri: document.toString() }
                };

                await client.sendNotification(lp.DidCloseTextDocumentNotification.method, didCloseParam);
            }
        }
        catch (error) {
            throw error;
        }
    }

}