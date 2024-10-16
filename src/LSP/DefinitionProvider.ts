import * as langclient from "vscode-languageclient/node";
import * as fs from "fs";
import * as vscode from "vscode";
import path from "path";
import { Executor } from "../Executor";
import { getFilePathInWorkspace } from "../env";
import { SwiftLSPClient } from "./SwiftLSPClient";

interface SymbolToken {
    symbol: string;
    container?: string;
    args: string[];
    offset: number;
    length: number;
}

export class DefinitionProvider {
    private dummyFile = getFilePathInWorkspace(".vscode/xcode/");
    private fileId = 0;

    constructor(private lspClient: SwiftLSPClient) {}

    async provide(document: vscode.TextDocument, position: vscode.Position) {
        // vscode.commands.executeCommand("workbench.action.showAllSymbols");
        const executor = new Executor();
        this.fileId++;
        const file = path.join(this.dummyFile, `dummy_structure_${this.fileId}.swift`);
        const text = document.getText();
        const positionOffset = document.offsetAt(position);
        fs.writeFileSync(file, text);

        const toCheckSymbols: SymbolToken[] = [];
        try {
            const localSymbolsStdout = await executor.execShell({
                scriptOrCommand: { command: "sourcekitten" },
                args: ["structure", "--file", file],
            });
            const localSymbols = JSON.parse(localSymbolsStdout.stdout)["key.substructure"];
            const symbols = findSymbol(positionOffset, localSymbols);
            const localSymbolAtPos = getSymbolAtPosition(positionOffset, text);

            for (const symbol of symbols) {
                if (isWhiteSpace(symbol.symbol) === true) {
                    continue;
                }
                const inKind = findSymbolInWorkspaceSymbols(localSymbolAtPos, symbol);
                if (inKind === "inSymbol") {
                    toCheckSymbols.push({
                        symbol: localSymbolAtPos.symbol,
                        container: localSymbolAtPos.container,
                        args:
                            localSymbolAtPos.symbol === symbol.symbol.split(".").at(-1)
                                ? symbol.args
                                : [],
                        offset: symbol.offset,
                        length: symbol.length,
                    });
                } else if (inKind === "inArgs") {
                    const symbols = symbol.symbol.split(".");
                    toCheckSymbols.push({
                        symbol: symbols.at(-1) || "",
                        container: symbols.at(-2),
                        args: symbol.args,
                        offset: symbol.offset,
                        length: symbol.length,
                    });
                }
            }
            if (toCheckSymbols.length === 0) {
                toCheckSymbols.push(localSymbolAtPos);
            }
        } catch (error) {
            console.log(error);
        } finally {
            fs.rmSync(file);
        }

        console.log(toCheckSymbols);

        for (const toCheck of toCheckSymbols) {
            if (toCheck.symbol.startsWith(".")) {
                toCheck.symbol = toCheck.symbol.slice(1);
            }
            const list = generateChecksFromSymbol(toCheck);
            for (const option of list) {
                const query = toString(option);
                const client = await this.lspClient.client();
                const result = await client.sendRequest(langclient.WorkspaceSymbolRequest.method, {
                    query: query,
                });
                let documentSymbol: vscode.SymbolInformation[] = (
                    result as vscode.SymbolInformation[]
                ).filter(e => {
                    if (option.args.length === 0) {
                        if (e.name.toLocaleLowerCase() === `${query}()`.toLowerCase()) {
                            return true;
                        }
                    }
                    return e.name.toLowerCase() === query.toLocaleLowerCase();
                });

                documentSymbol = filtered(documentSymbol, e => {
                    try {
                        return e.containerName
                            .toLowerCase()
                            .includes(option.container!.toLowerCase());
                    } catch {
                        return false;
                    }
                });

                if (documentSymbol && documentSymbol.length > 0) {
                    return sortedDocumentSymbol(documentSymbol, option).map(e => {
                        const uri = vscode.Uri.parse(e.location.uri.toString());
                        return new vscode.Location(uri, e.location.range);
                    });
                }
            }
        }

        return [];
    }
}

function filtered(
    list: vscode.SymbolInformation[],
    mapper: (val: vscode.SymbolInformation) => boolean
) {
    const result = list.filter(mapper);
    if (result.length > 0) {
        return result;
    }
    return list;
}

function sortedDocumentSymbol(
    documentSymbols: vscode.SymbolInformation[],
    symbolToken: SymbolToken
) {
    // check if there's exact match
    documentSymbols = filtered(documentSymbols, e => {
        return symbolToken.symbol === e.name;
    });
    documentSymbols = filtered(documentSymbols, e => {
        return symbolToken.container === e.containerName;
    });
    if (symbolToken.symbol === "init") {
        // likely constructor
        documentSymbols = filtered(documentSymbols, e => {
            return e.kind === vscode.SymbolKind.Constructor;
        });
    }
    if (symbolToken.args.length === 0 && symbolToken.container !== undefined) {
        /// likely property or field
        documentSymbols = filtered(documentSymbols, e => {
            switch (e.kind) {
                case vscode.SymbolKind.Property:
                case vscode.SymbolKind.Field:
                    return true;
                default:
                    return false;
            }
        });
    }
    if (symbolToken.args.length > 0) {
        // likely method
        documentSymbols = filtered(documentSymbols, e => {
            return e.kind === vscode.SymbolKind.Method || e.kind === vscode.SymbolKind.Function;
        });
    }
    return documentSymbols;
}

function generateChecksFromSymbol(symbol: SymbolToken) {
    const result: SymbolToken[] = [symbol];
    if (symbol.args.length > 0) {
        result.push({
            symbol: "init",
            args: symbol.args,
            container: symbol.symbol, // in that case it's an init of Symbol struct or class
            offset: symbol.offset,
            length: symbol.length,
        });
    }

    return result;
}

function findSymbolInWorkspaceSymbols(localSymbol: SymbolToken, workspaceSymbol: SymbolToken) {
    if (workspaceSymbol.symbol.includes(localSymbol.symbol)) {
        return "inSymbol";
    }
    for (const arg of workspaceSymbol.args) {
        if (arg.includes(localSymbol.symbol)) {
            return "inArgs";
        }
    }
}

function toString(symbol: SymbolToken) {
    if (symbol.args.length === 0) {
        return symbol.symbol;
    }
    return `${symbol.symbol}(${symbol.args.join(":")}:)`;
}

function isWhiteSpace(ch: string) {
    return /\s/.test(ch);
}

function isNotAllowedChar(ch: string) {
    return /[\s[\]()"',.{}:?!]/.test(ch);
}

function getSymbolAtPosition(position: number, text: string): SymbolToken {
    let result = "";
    if (isNotAllowedChar(text[position])) {
        return { symbol: "", args: [], offset: position, length: 0 };
    }
    for (let i = position; i < text.length; ++i) {
        if (isNotAllowedChar(text[i])) {
            break;
        }
        result += text[i];
    }
    let i = position - 1;
    for (; i >= 0; --i) {
        if (isNotAllowedChar(text[i])) {
            break;
        }
        result = text[i] + result;
    }

    let container = "";
    if (i >= 0 && text[i] === ".") {
        const dotI = i;
        for (i--; i >= 0; --i) {
            if (isNotAllowedChar(text[i])) {
                if (i + 1 === dotI && (text[i] === "?" || text[i] === "!")) {
                    continue;
                }
                break;
            }
            container = text[i] + container;
        }
    }

    return {
        symbol: result,
        container: container.length === 0 ? undefined : container,
        args: [],
        offset: i + 1,
        length: result.length + container.length,
    };
}

function isReference(symbol: string) {
    if (symbol === undefined) {
        return false;
    }
    return symbol.includes("expr.call");
}

function isArgument(symbol: string) {
    if (symbol === undefined) {
        return false;
    }
    return symbol.includes("argument");
}

function findSymbol(positionOffset: number, tree: any): SymbolToken[] {
    if (tree === undefined || tree === null) {
        return [];
    }

    const result: SymbolToken[] = [];
    if (tree instanceof Array) {
        for (const structure of tree) {
            result.push(...findSymbol(positionOffset, structure));
        }
        return result;
    }
    let substructure: any | undefined = undefined;
    try {
        if (Object.prototype.hasOwnProperty.call(tree, "key.substructure")) {
            substructure = tree["key.substructure"];
            result.push(...findSymbol(positionOffset, substructure));
        }
        const keyOffset = tree["key.offset"] as number;
        const keyLength = tree["key.length"] as number;
        const name = (tree["key.name"] as string).replaceAll("?", "").replaceAll("!", "");
        const kind = tree["key.kind"] as string;

        if (
            keyOffset === undefined ||
            keyLength === undefined ||
            name === undefined ||
            kind === undefined
        ) {
            return result;
        }
        if (
            isReference(kind) &&
            keyOffset <= positionOffset &&
            positionOffset < keyOffset + keyLength
        ) {
            if (substructure !== undefined) {
                const args = substructure
                    .filter((arg: any) => {
                        try {
                            if (arg["key.name"].length > 0) {
                                return isArgument(arg["key.kind"]);
                            }
                            return false;
                        } catch {
                            return false;
                        }
                    })
                    .map((arg: any) => {
                        return arg["key.name"];
                    });
                if (args.length > 0) {
                    result.push({ symbol: name, args: args, offset: keyOffset, length: keyLength });
                } else {
                    result.push({
                        symbol: name,
                        args: [],
                        offset: keyOffset,
                        length: keyLength,
                    });
                }
            } else {
                result.push({ symbol: name, args: [], offset: keyOffset, length: keyLength });
            }
        }
    } catch {
        result.push(...findSymbol(positionOffset, substructure));
    }
    return result;
}
