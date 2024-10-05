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
            console.log(`FETCHING TESTS FOR URL: ${document.toString()}`);

            const client = await this.lspClient.client();

            const content = fs.readFileSync(document.fsPath).toString();
            const didOpenParam: lp.DidOpenTextDocumentParams = {
                textDocument: { uri: document.toString(), languageId: "swift", text: content, version: 1 }
            };

            await client.sendNotification(lp.DidOpenTextDocumentNotification.method, didOpenParam);

            const testsInDocument = await (await this.lspClient.client()).sendRequest(
                textDocumentTestsRequest,
                { textDocument: { uri: document.toString() } }
            );

            const didCloseParam: lp.DidCloseTextDocumentParams = {
                textDocument: { uri: document.toString() }
            };

            await client.sendNotification(lp.DidCloseTextDocumentNotification.method, didCloseParam);

            console.log(testsInDocument);
            return testsInDocument;
        }
        catch (error) {
            throw error;
        }
    }

}