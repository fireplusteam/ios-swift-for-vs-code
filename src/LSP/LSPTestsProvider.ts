import * as vscode from "vscode"
import { LSPTestItem, textDocumentTestsRequest } from "./lspExtension";
import { SwiftLSPClient } from "./SwiftLSPClient";
import { sleep } from "../extension";

export class LSPTestsProvider {

    constructor(private lspClient: SwiftLSPClient) {

    }

    async fetchTests(document: vscode.Uri): Promise<LSPTestItem[]> {
        try {
            const testsInDocument = await (await this.lspClient.client()).sendRequest(
                textDocumentTestsRequest,
                { textDocument: { uri: document.toString() } }
            );
            console.log(testsInDocument);
            return testsInDocument;
        }
        catch (error) {
            throw error;
        }
    }

}