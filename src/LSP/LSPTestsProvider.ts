import * as vscode from "vscode";
import { languageId, LSPTestItem, textDocumentTestsRequest } from "./lspExtension";
import { SwiftLSPClient } from "./SwiftLSPClient";
import * as lp from "vscode-languageserver-protocol";
import * as fs from "fs";
import { getFilePathInWorkspace } from "../env";

export class LSPTestsProvider {
    private version = 0;
    private dummyFile = getFilePathInWorkspace(".vscode/xcode/dummy.swift");
    private request: Promise<LSPTestItem[]> | undefined;

    constructor(private lspClient: SwiftLSPClient) {
        fs.writeFileSync(this.dummyFile, "");
    }

    async fetchTests(document: vscode.Uri, content: string): Promise<LSPTestItem[]> {
        if (this.request) {
            try {
                await this.request;
            } catch {
                /* empty */
            }
        }

        const isRequested = this.performFetch(document, content);
        this.request = isRequested;
        return isRequested;
    }

    private async performFetch(document: vscode.Uri, content: string) {
        this.version++;
        const client = await this.lspClient.client();
        const langId = languageId(document.fsPath);
        if (langId !== "swift") {
            return [];
        }

        const dummyUri = vscode.Uri.file(this.dummyFile);

        const didOpenParam: lp.DidOpenTextDocumentParams = {
            textDocument: {
                uri: dummyUri.toString(),
                languageId: langId,
                text: content,
                version: this.version,
            },
        };

        await client.sendNotification(lp.DidOpenTextDocumentNotification.method, didOpenParam);

        try {
            const testsInDocument = await (
                await this.lspClient.client()
            ).sendRequest(textDocumentTestsRequest, {
                textDocument: { uri: dummyUri.toString() },
            });
            return testsInDocument;
        } finally {
            // const didCloseParam: lp.DidCloseTextDocumentParams = {
            //     textDocument: { uri: dummyUri.toString() },
            // };
            // await client.sendNotification(
            //     lp.DidCloseTextDocumentNotification.method,
            //     didCloseParam
            // );
        }
    }
}
