import * as langclient from "vscode-languageclient/node";
import * as vscode from "vscode";
import * as fs from "fs";
import { SwiftLSPClient } from "./SwiftLSPClient";
import {
    preCalcCommentedCode,
    preCalcLineNumbers,
} from "../TestsProvider/TestItemProvider/parseClass";

interface SymbolToken {
    symbol: string;
    container?: string;
    args: string[];
    offset: number;
    length: number;
}

export class DefinitionProvider {
    private maxNumberOfRecursiveSearch = 3; // no need to call it deeper

    constructor(private lspClient: SwiftLSPClient) {}

    async provide(document: vscode.TextDocument, position: vscode.Position, recursiveCall = 0) {
        if (recursiveCall >= this.maxNumberOfRecursiveSearch) {
            return [];
        }
        // vscode.commands.executeCommand("workbench.action.showAllSymbols");
        const text = document.getText();
        const positionOffset = document.offsetAt(position);

        const symbolAtCursorPosition = getSymbolAtPosition(positionOffset, text);
        if (symbolAtCursorPosition === undefined) {
            return [];
        }

        if (symbolAtCursorPosition.symbol.startsWith(".")) {
            symbolAtCursorPosition.symbol = symbolAtCursorPosition.symbol.slice(1);
        }

        let parentContainer: string[] = [];
        if (symbolAtCursorPosition.container !== undefined) {
            const containerPositionExactPos = await this.sendDefinitionRequest(
                document,
                symbolAtCursorPosition.offset
            );

            if (containerPositionExactPos !== null && containerPositionExactPos.length > 0) {
                const hovers = containerPositionExactPos.map(async e => {
                    const offset = document.offsetAt(e.range.start);
                    const hover = await this.sendHoverRequest(document, offset);
                    return hover?.at(0) || "";
                });
                for (const hover of hovers) {
                    parentContainer.push(await hover);
                }
                //parentContainer = transformToLine(containerPositionExactPos);
            } else {
                const containerPos = document.positionAt(symbolAtCursorPosition.offset);
                const rootSuggestions = await this.provide(
                    document,
                    containerPos,
                    recursiveCall + 1
                );
                parentContainer = transformToLine(rootSuggestions);
            }
        }

        const optionsToCheck = generateChecksFromSymbol(symbolAtCursorPosition);
        for (const option of optionsToCheck) {
            const query = SymbolToString(option);
            const client = await this.lspClient.client();
            const result = await client.sendRequest(langclient.WorkspaceSymbolRequest.method, {
                query: query,
            });
            let documentSymbol: vscode.SymbolInformation[] = (
                result as vscode.SymbolInformation[]
            ).filter(e => {
                if (option.args.length === 0) {
                    // can be a method symbol
                    if (e.name.toLocaleLowerCase() === `${query}()`.toLowerCase()) {
                        return true;
                    }
                }
                if (query.endsWith(")")) {
                    if (e.name.startsWith(query.slice(0, -1))) {
                        return true;
                    }
                }
                return e.name.toLowerCase() === query.toLocaleLowerCase();
            });

            documentSymbol = filtered(documentSymbol, e => {
                try {
                    return containerLinesHasContainer(parentContainer, e.containerName);
                } catch {
                    return false;
                }
            });

            documentSymbol = filtered(documentSymbol, e => {
                try {
                    return e.containerName.toLowerCase().includes(option.container!.toLowerCase());
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

        return [];
    }

    private async sendDefinitionRequest(document: vscode.TextDocument, offset: number) {
        const definitionPos = document.positionAt(offset);
        const definitionParams: langclient.DefinitionParams = {
            textDocument: { uri: document.uri.toString() },
            position: langclient.Position.create(definitionPos.line, definitionPos.character),
        };
        try {
            const locations = (await (
                await this.lspClient.client()
            ).sendRequest(
                langclient.DefinitionRequest.method,
                definitionParams
            )) as langclient.Location[];
            return locations.map(e => {
                const uri = vscode.Uri.parse(e.uri.toString());
                return new vscode.Location(uri, e.range as vscode.Range);
            });
        } catch {
            return [];
        }
    }

    private async sendHoverRequest(document: vscode.TextDocument, offset: number) {
        const hoverPos = document.positionAt(offset);
        const hoverParams: langclient.HoverParams = {
            textDocument: { uri: document.uri.toString() },
            position: langclient.Position.create(hoverPos.line, hoverPos.character),
        };
        try {
            const hover = (await (
                await this.lspClient.client()
            ).sendRequest(langclient.HoverRequest.method, hoverParams)) as langclient.Hover;
            const result = covertHoverToString(hover);
            if (result) {
                return result.filter(e => e.includes("<<error type>>") === false);
            }
            return null;
        } catch {
            return null;
        }
    }
}

function covertHoverToString(hover: langclient.Hover) {
    if (hover.contents instanceof Array) {
        return hover.contents
            .map(e => {
                if (typeof e === "string") {
                    return e;
                } else if (typeof e === "object") {
                    return e.value;
                }
                return "";
            })
            .filter(e => e !== "");
    } else if (typeof hover.contents === "string") {
        return [hover.contents];
    } else if (typeof hover.contents === "object") {
        return [hover.contents.value];
    }
}

/// Local symbol parser

function containerLinesHasContainer(containers: string[], containerName: string) {
    for (const item of containers) {
        if (containerName === undefined || containerName.length === 0) {
            return false;
        }
        if (item.includes(containerName)) {
            return true;
        }
    }
    return false;
}

function transformToLine(locations: vscode.Location[]) {
    return locations.map(e => {
        const document = vscode.workspace.textDocuments
            .filter(doc => doc.uri.fsPath === e.uri.fsPath)
            .at(0);
        if (document) {
            // document was edited, check the cached version
            return document.getText(
                new vscode.Range(
                    new vscode.Position(e.range.start.line, 0),
                    new vscode.Position(e.range.end.line, 10000)
                )
            );
        } // else this doc file is not open, fine to read it from a disk
        const text = fs.readFileSync(e.uri.fsPath).toString();
        const line = preCalcLineNumbers(text);
        let result = "";
        for (let i = 0; i < text.length; ++i) {
            if (e.range.start.line <= line[i] && line[i] <= e.range.end.line) {
                result += text[i];
            }
        }
        return result;
    });
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

function SymbolToString(symbol: SymbolToken) {
    if (symbol.args.length === 0) {
        return symbol.symbol;
    }
    return `${symbol.symbol}(${symbol.args.join(":")}:)`;
}

function isWhiteSpace(ch: string) {
    return /\s/.test(ch);
}

function isNotAllowedChar(ch: string) {
    return /[\s[\]()"',.{}:]/.test(ch);
}

function parseSingleToken(position: number, text: string, commented: boolean[]) {
    if (isNotAllowedChar(text[position])) {
        return undefined;
    }
    if (commented[position]) {
        return undefined;
    }
    const chars = ":()[]{}-+*/\"',. \n\r\t";
    const end = moveUntilChar(position, text, "right", chars, commented);
    if (end === undefined) {
        return undefined;
    }
    const start = moveUntilChar(position, text, "left", chars, commented);
    if (start === undefined) {
        return undefined;
    }

    return { token: text.slice(start + 1, end), start: start + 1, end: end - 1 };
}

function parseContainer(position: number, text: string, commented: boolean[]) {
    for (let i = position; i >= 0; --i) {
        if (isWhiteSpace(text[i]) === false) {
            if (text[i] === ".") {
                const j = i;
                for (i -= 1; i >= 0 && isWhiteSpace(text[i]); --i) {
                    /* empty */
                }
                if (text[i] === ")") {
                    // for example someFunc(parameter1: "a").symbol
                    const containerPos = getScope(text, i - 1, "left", commented);
                    if (containerPos) {
                        i = containerPos - 1;
                    }
                } else {
                    // not found ')'
                    i = j - 1;
                }
                return parseSingleToken(i, text, commented);
            } else {
                return undefined;
            }
        }
    }
}

function moveUntilChar(
    position: number,
    text: string,
    direction: "left" | "right",
    chars: string,
    commented: boolean[]
) {
    if (direction === "left") {
        for (let i = position; i >= 0; --i) {
            if (commented[i]) {
                continue;
            }
            if (chars.includes(text[i])) {
                return i;
            }
            if (isWhiteSpace(text[i]) === true) {
                return undefined;
            }
        }
    } else {
        for (let i = position; i < text.length; ++i) {
            if (commented[i]) {
                continue;
            }
            if (chars.includes(text[i])) {
                return i;
            }
            if (isWhiteSpace(text[i]) === true) {
                return undefined;
            }
        }
    }
}

function argumentPos(
    token: string,
    text: string,
    start: number,
    end: number,
    commented: boolean[]
) {
    const posArgumentDot = moveUntilChar(end + 1, text, "right", ":", commented);
    const posOthers = moveUntilChar(end + 1, text, "right", ".()[]{}-+*/\"',. \n\r\t", commented);
    if (posArgumentDot !== undefined) {
        if (posOthers === undefined) {
            return posArgumentDot;
        }
        if (posOthers > posArgumentDot) {
            return posArgumentDot;
        }
    }
}

function getScope(
    text: string,
    position: number,
    direction: "left" | "right",
    commented: boolean[]
) {
    const stack = [] as string[];
    if (direction === "right") {
        for (let i = position; i < text.length; ++i) {
            if (commented[i]) {
                continue;
            }
            if (text[i] === "(") {
                stack.push(text[i]);
            } else if (text[i] === ")") {
                if (stack.length === 0) {
                    return i;
                }
                stack.pop();
            }
        }
    } else {
        for (let i = position; i >= 0; --i) {
            if (commented[i]) {
                continue;
            }
            if (text[i] === ")") {
                stack.push(text[i]);
            } else if (text[i] === "(") {
                if (stack.length === 0) {
                    return i;
                }
                stack.pop();
            }
        }
    }
}

function parseArguments(position: number, text: string, commented: boolean[]) {
    const stack = [] as string[];
    const mapper = new Map<string, string>();
    mapper.set("{", "}");
    mapper.set("[", "]");
    mapper.set("(", ")");

    let isInsideArgument = true;
    let argumentName = "";
    const parsedArgs = [] as string[];
    let i = position;
    for (; i < text.length; ++i) {
        if (commented[i]) {
            continue;
        }
        if ("([{".includes(text[i])) {
            stack.push(text[i]);
        } else if (")]}".includes(text[i])) {
            const val = stack.pop();
            if (val === undefined || mapper.get(val) !== text[i]) {
                return undefined;
            }

            if (stack.length === 0) {
                break;
            }
        } else if (stack.length === 1) {
            if (text[i] === ",") {
                if (isInsideArgument) {
                    parsedArgs.push("");
                }
                isInsideArgument = true;
                argumentName = "";
            } else if (text[i] === ":") {
                isInsideArgument = false;
                argumentName = argumentName.trim();
                parsedArgs.push(argumentName);
                argumentName = "";
            } else if (isInsideArgument) {
                argumentName += text[i];
            }
        } else if (stack.length === 0 && isWhiteSpace(text[i]) === false) {
            return undefined;
        }
    }
    if (isInsideArgument && (argumentName.length > 0 || `"'`.includes(text[i - 1]))) {
        parsedArgs.push("");
    }
    return parsedArgs;
}

function getSymbolAtPosition(position: number, text: string): SymbolToken | undefined {
    const commented = preCalcCommentedCode(text);
    const symbol = parseSingleToken(position, text, commented);
    if (symbol === undefined) {
        return undefined;
    }

    const argumentDot = argumentPos(symbol.token, text, symbol.start, symbol.end, commented);
    let container: { token: string; start: number; end: number } | undefined = undefined;
    let args: string[] = [];
    if (argumentDot === undefined) {
        // not an argument
        // parse arguments and container
        container = parseContainer(symbol.start - 1, text, commented);
        args = parseArguments(symbol.end + 1, text, commented) || [];
        args = args.map(e => {
            if (e === "") {
                return "_";
            }
            return e;
        });
    } else {
        // argument
        const rightScope = getScope(text, symbol.end + 1, "right", commented);
        const leftScope = getScope(text, symbol.start - 1, "left", commented);
        if (rightScope !== undefined && leftScope !== undefined) {
            return getSymbolAtPosition(leftScope - 1, text);
        }
    }

    return {
        symbol: symbol.token.replaceAll("?", "").replaceAll("!", ""),
        container: container?.token.replaceAll("?", "").replaceAll("!", ""),
        args: args,
        offset: container !== undefined ? container.start : symbol.start,
        length:
            container !== undefined
                ? container.end - container.start + 1
                : symbol.end - symbol.start + 1,
    };
}

export const _private = {
    getSymbolAtPosition,
};

// function isReference(symbol: string) {
//     if (symbol === undefined) {
//         return false;
//     }
//     return symbol.includes("expr.call");
// }

// function isArgument(symbol: string) {
//     if (symbol === undefined) {
//         return false;
//     }
//     return symbol.includes("argument");
// }

// function findSymbol(positionOffset: number, tree: any): SymbolToken[] {
//     if (tree === undefined || tree === null) {
//         return [];
//     }

//     const result: SymbolToken[] = [];
//     if (tree instanceof Array) {
//         for (const structure of tree) {
//             result.push(...findSymbol(positionOffset, structure));
//         }
//         return result;
//     }
//     let substructure: any | undefined = undefined;
//     try {
//         if (Object.prototype.hasOwnProperty.call(tree, "key.substructure")) {
//             substructure = tree["key.substructure"];
//             result.push(...findSymbol(positionOffset, substructure));
//         }
//         const keyOffset = tree["key.offset"] as number;
//         const keyLength = tree["key.length"] as number;
//         const name = (tree["key.name"] as string).replaceAll("?", "").replaceAll("!", "");
//         const kind = tree["key.kind"] as string;

//         if (
//             keyOffset === undefined ||
//             keyLength === undefined ||
//             name === undefined ||
//             kind === undefined
//         ) {
//             return result;
//         }
//         if (
//             isReference(kind) &&
//             keyOffset <= positionOffset &&
//             positionOffset < keyOffset + keyLength
//         ) {
//             if (substructure !== undefined) {
//                 const args = substructure
//                     .filter((arg: any) => {
//                         try {
//                             if (arg["key.name"].length > 0) {
//                                 return isArgument(arg["key.kind"]);
//                             }
//                             return false;
//                         } catch {
//                             return false;
//                         }
//                     })
//                     .map((arg: any) => {
//                         return arg["key.name"];
//                     });
//                 if (args.length > 0) {
//                     result.push({ symbol: name, args: args, offset: keyOffset, length: keyLength });
//                 } else {
//                     result.push({
//                         symbol: name,
//                         args: [],
//                         offset: keyOffset,
//                         length: keyLength,
//                     });
//                 }
//             } else {
//                 result.push({ symbol: name, args: [], offset: keyOffset, length: keyLength });
//             }
//         }
//     } catch {
//         result.push(...findSymbol(positionOffset, substructure));
//     }
//     return result;
// }
