import * as langclient from "vscode-languageclient/node";
import * as vscode from "vscode";
import { SwiftLSPClient } from "./SwiftLSPClient";
import { preCalcCommentedCode } from "../TestsProvider/TestItemProvider/parseClass";

interface SymbolToken {
    symbol: string;
    container?: string;
    args: string[];
    offset: number;
    length: number;
}

export class DefinitionProvider {
    constructor(private lspClient: SwiftLSPClient) {}

    async provide(document: vscode.TextDocument, position: vscode.Position) {
        // vscode.commands.executeCommand("workbench.action.showAllSymbols");
        const text = document.getText();
        const positionOffset = document.offsetAt(position);

        const toCheck = getSymbolAtPosition(positionOffset, text);

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
    return /[\s[\]()"',.{}:]/.test(ch);
}

function parseSingleToken(position: number, text: string, commented: boolean[]) {
    if (isNotAllowedChar(text[position])) {
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
            if (text[i] === ")") {
                // start of function
                // TODO:
                return undefined;
            } else if (text[i] === ".") {
                // dot
                return parseSingleToken(i - 1, text, commented)?.token;
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
    for (let i = position; i < text.length; ++i) {
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
    if (isInsideArgument && argumentName.trim().length > 0) {
        parsedArgs.push("");
    }
    return parsedArgs;
}

function getSymbolAtPosition(position: number, text: string): SymbolToken {
    const commented = preCalcCommentedCode(text);
    const symbol = parseSingleToken(position, text, commented);
    if (symbol === undefined) {
        return { symbol: "", args: [], offset: position, length: 0 };
    }

    const argumentDot = argumentPos(symbol.token, text, symbol.start, symbol.end, commented);
    let container: string | undefined = undefined;
    let args: string[] = [];
    if (argumentDot === undefined) {
        // not an argument
        // parse arguments
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
        container: container,
        args: args,
        offset: symbol.start,
        length: symbol.end - symbol.start + 1,
    };
}

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
