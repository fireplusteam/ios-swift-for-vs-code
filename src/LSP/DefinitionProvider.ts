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
    endOffset: number;
}

export class DefinitionProvider {
    private maxNumberOfRecursiveSearch = 3; // no need to call it deeper

    constructor(private lspClient: SwiftLSPClient) {}

    private async provideContainer(
        positionOffset: number,
        text: string,
        document: vscode.TextDocument
    ): Promise<Set<string>> {
        const definitionPos = await this.sendDefinitionRequest(document, positionOffset);
        const types = new Set<string>();
        if (definitionPos !== null && definitionPos.length > 0) {
            for (const definition of definitionPos) {
                if (definition.uri.toString() !== document.uri.toString()) {
                    continue;
                }
                const offset = document.offsetAt(definition.range.start);
                (await this.sendHoverRequest(document, offset))?.forEach(hover => {
                    const type = parseVariableType(hover);
                    if (type !== undefined) {
                        types.add(type);
                    }
                });
            }
            return splitContainers(types);
        }

        const symbolAtCursorPosition = getSymbolAtPosition(positionOffset, text);
        if (symbolAtCursorPosition === undefined) {
            // not a symbol
            return new Set<string>();
        }
        const query = SymbolToString(symbolAtCursorPosition);
        let allSymbols = ((await this.sendAllSymbols(query)) || []).filter(e => {
            if (symbolAtCursorPosition.args.length === 0) {
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
        if (allSymbols === undefined || allSymbols.length === 0) {
            return new Set<string>();
        }
        if (symbolAtCursorPosition.container === undefined) {
            // root element, no containers found
            allSymbols = allSymbols.filter(symbol => {
                return symbol.containerName !== undefined && symbol.containerName.length > 0;
            });
            return transformToTypes();
        }
        if (allSymbols.length > 1) {
            const containers = await this.provideContainer(
                symbolAtCursorPosition.offset,
                text,
                document
            );
            allSymbols.filter(symbol => {
                if (containers.size > 0) {
                    return containers.has(symbol.containerName);
                }
                return true;
            });
        }

        return transformToTypes();

        function transformToTypes() {
            transformToLine(symbolToLocation(allSymbols)).forEach(location => {
                const type = parseVariableType(location);
                if (type !== undefined) {
                    types.add(type);
                }
            });
            return splitContainers(types);
        }
    }

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

        let containers = new Set<string>();
        if (symbolAtCursorPosition.container !== undefined) {
            containers = await this.provideContainer(symbolAtCursorPosition.offset, text, document);
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
                    if (containers.size > 0) {
                        return containers.has(e.containerName);
                    }
                    return true;
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

    private async sendAllSymbols(query: string) {
        const client = await this.lspClient.client();
        const result = await client.sendRequest(langclient.WorkspaceSymbolRequest.method, {
            query: query,
        });
        const documentSymbol: vscode.SymbolInformation[] = result as vscode.SymbolInformation[];

        if (documentSymbol && documentSymbol.length > 0) {
            return documentSymbol;
        }
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

function splitContainers(containers: Set<string>) {
    const result = new Set<string>();
    for (const val of containers) {
        let filtered = "";
        for (let i = 0; i < val.length; ) {
            if (val[i] === "<") {
                i = getScope(val, i + 1, "right", undefined, "<", ">") || val.length;
                i++;
            } else {
                filtered += val[i];
                i++;
            }
        }
        const newVal = filtered.replaceAll("?", "").replaceAll("!", "").split(".");
        const last = newVal.at(-1);
        if (last) {
            result.add(last);
        }
    }
    return result;
}

function symbolToLocation(symbols: vscode.SymbolInformation[]) {
    return symbols.map(e => {
        const uri = vscode.Uri.parse(e.location.uri.toString());
        return new vscode.Location(uri, e.location.range);
    });
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
            endOffset: symbol.endOffset,
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

function movePosIfTextEqual(text: string, pos: number, str: string[] | string) {
    if (str instanceof Array) {
        for (const s of str) {
            if (text.slice(pos, pos + s.length) === s) {
                return pos + s.length;
            }
        }
        return pos;
    }
    return text.slice(pos, pos + str.length) === str ? pos + str.length : pos;
}

function movePosUntilFirstNonWhiteSpace(text: string, pos: number) {
    for (; pos < text.length; ++pos) {
        if (isWhiteSpace(text[pos]) === true) {
            return pos;
        }
    }
    return pos;
}

function parseType(text: string, pos: number, commented: boolean[]) {
    let result = "";
    for (; pos < text.length; ++pos) {
        if (commented[pos]) {
            continue;
        }
        if (text[pos] === "<") {
            let next = getScope(text, pos + 1, "right", commented, "<", ">");
            if (next) {
                next += 1;
            } else {
                next = text.length;
            }
            for (; pos < next; ++pos) {
                if (!commented[pos]) {
                    result += text[pos];
                }
            }
            for (; pos < text.length; ++pos) {
                if (!commented[pos]) {
                    if (
                        (isWhiteSpace(text[pos]) === false && text[pos] === "?") ||
                        text[pos] === "!"
                    ) {
                        result += text[pos];
                        break;
                    }
                }
            }
            break;
        }
        if ("\n{:".includes(text[pos])) {
            break;
        }
        result += text[pos];
    }
    return result.replaceAll(/\s/g, "").replaceAll("`", "");
}

function parseVariableType(text: string) {
    const commented = preCalcCommentedCode(text);
    let state: "var" | "typealias" | "type" | "func" | "funcReturn" | "none" = "none";
    let nextI = 0;
    for (let i = 0; i < text.length; i = nextI) {
        switch (state) {
            case "none":
                nextI = movePosIfTextEqual(text, i, ["init", "case"]);
                if (nextI !== i) {
                    return undefined;
                }
                nextI = movePosIfTextEqual(text, i, ["let", "var"]);
                if (nextI !== i) {
                    state = "var";
                    continue;
                }
                nextI = movePosIfTextEqual(text, i, "func");
                if (nextI !== i) {
                    state = "func";
                    continue;
                }

                nextI = movePosIfTextEqual(text, i, "typealias");
                if (nextI !== i) {
                    state = "typealias";
                    continue;
                }

                nextI = movePosIfTextEqual(text, i, ["class", "struct", "enum"]);
                if (nextI !== i) {
                    state = "type";
                    continue;
                }

                break;
            case "var":
                if (text[i] === ":") {
                    state = "type";
                }
                break;
            case "typealias":
                if (text[i] === "=") {
                    state = "type";
                }
                break;
            case "type":
                if (text[i] === "@") {
                    nextI = movePosUntilFirstNonWhiteSpace(text, i);
                    continue;
                }
                nextI = movePosIfTextEqual(text, i, ["any ", "some "]);
                if (nextI !== i) {
                    continue;
                }

                if (text[i] === "(") {
                    // func
                    state = "funcReturn";
                    nextI = getScope(text, i + 1, "right", commented) || i + 1;
                    continue;
                }
                if (isWhiteSpace(text[i]) === false) {
                    return parseType(text, i, commented);
                }
                break;
            case "func":
                if (text[i] === "(") {
                    nextI = getScope(text, i + 1, "right", commented) || i + 1;
                    state = "funcReturn";
                    continue;
                }
                break;
            case "funcReturn":
                nextI = movePosIfTextEqual(text, i, "->");
                if (nextI !== i) {
                    state = "type";
                    continue;
                }
                if ("{\n".includes(text[i]) || i === text.length - 1) {
                    return "Void";
                }
                break;
        }
        nextI = i + 1; // else
    }
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
        return -1;
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
        return text.length;
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
    commented: boolean[] | undefined,
    scopeChar: string = "(",
    reversalScopeChar: string = ")"
) {
    const stack = [] as string[];
    if (direction === "right") {
        for (let i = position; i < text.length; ++i) {
            if (commented !== undefined && commented[i]) {
                continue;
            }
            if (text[i] === scopeChar) {
                stack.push(text[i]);
            } else if (text[i] === reversalScopeChar) {
                if (stack.length === 0) {
                    return i;
                }
                stack.pop();
            }
        }
    } else {
        for (let i = position; i >= 0; --i) {
            if (commented !== undefined && commented[i]) {
                continue;
            }
            if (text[i] === reversalScopeChar) {
                stack.push(text[i]);
            } else if (text[i] === scopeChar) {
                if (stack.length === 0) {
                    return i;
                }
                stack.pop();
            }
        }
    }
}

function parseArguments(
    position: number,
    text: string,
    commented: boolean[]
): { args: string[]; end: number } | undefined {
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
    return { args: parsedArgs, end: i };
}

function getSymbolAtPosition(position: number, text: string): SymbolToken | undefined {
    const commented = preCalcCommentedCode(text);
    const symbol = parseSingleToken(position, text, commented);
    if (symbol === undefined) {
        return undefined;
    }

    const argumentDot = argumentPos(symbol.token, text, symbol.start, symbol.end, commented);
    let container: { token: string; start: number; end: number } | undefined = undefined;
    let args: { args: string[]; end: number } | undefined;
    if (argumentDot === undefined) {
        // not an argument
        // parse arguments and container
        container = parseContainer(symbol.start - 1, text, commented);
        args = parseArguments(symbol.end + 1, text, commented);
        if (args) {
            args.args = args.args.map(e => {
                if (e === "") {
                    return "_";
                }
                return e;
            });
        }
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
        args: args?.args || [],
        offset: container !== undefined ? container.start : symbol.start,
        endOffset: args?.end || symbol.end,
    };
}

export const _private = {
    getSymbolAtPosition,
    parseVariableType,
    splitContainers,
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
