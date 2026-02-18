import * as langclient from "vscode-languageclient/node";
import * as vscode from "vscode";
import * as fs from "fs";
import { SwiftLSPClient } from "./SwiftLSPClient";
import { preCalcCommentedCode } from "../TestsProvider/TestItemProvider/parseClass";
import { languageId } from "./lspExtension";
// import Fuse from "fuse.js";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Fuse = require("fuse.js");

interface SymbolToken {
    symbol: string;
    container?: string;
    args: string[];
    offset: number;
    endOffset: number;
}

// if it's more then 20, then it's too many combination anyway
const maxNumberOfSymbolsToCheckOnTypes = 20;
const maxRecursiveCalls = 3;

export class DefinitionProvider {
    constructor(private lspClient: SwiftLSPClient) {}

    async provide(
        document: vscode.TextDocument,
        position: vscode.Position,
        cancel: vscode.CancellationToken
    ) {
        const text = document.getText();
        const positionOffset = document.offsetAt(position);

        const symbolAtCursorPosition = getSymbolAtPosition(positionOffset, text);
        if (symbolAtCursorPosition === undefined) {
            return [];
        }

        let containers = new Set<string>();
        if (symbolAtCursorPosition.container !== undefined) {
            containers = await this.provideContainer(
                symbolAtCursorPosition.offset,
                text,
                document,
                0,
                cancel
            );
        }

        const provide = async (option: SymbolToken) => {
            if (cancel.isCancellationRequested) {
                return [];
            }
            const query = SymbolToString(option);
            const client = await this.lspClient.client();
            const result = (await client.sendRequest(langclient.WorkspaceSymbolRequest.method, {
                query: query,
            })) as langclient.SymbolInformation[];
            if (result && result.length > 0) {
                return sortedDocumentSymbol(
                    document.uri.toString(),
                    result,
                    option.symbol,
                    option.container,
                    containers,
                    option.args
                ).map(e => {
                    const uri = vscode.Uri.parse(e.location.uri.toString());
                    return new vscode.Location(uri, e.location.range as vscode.Range);
                });
            }
        };
        let result = await provide(symbolAtCursorPosition);
        if (result !== undefined && result.length > 0) {
            return result;
        }
        if (symbolAtCursorPosition.symbol[0] === symbolAtCursorPosition.symbol[0].toUpperCase()) {
            // probably a constructor
            symbolAtCursorPosition.container = symbolAtCursorPosition.symbol;
            symbolAtCursorPosition.symbol = "init";
            containers = new Set([symbolAtCursorPosition.container]);
            result = await provide(symbolAtCursorPosition);
            if (result !== undefined) {
                return result;
            }
        } else if (symbolAtCursorPosition.args.length > 0) {
            // probably a property of closure type
            symbolAtCursorPosition.args = [];
            result = await provide(symbolAtCursorPosition);
            if (result !== undefined) {
                return result;
            }
        }

        return [];
    }

    private async provideContainer(
        positionOffset: number,
        text: string,
        document: vscode.TextDocument,
        recursiveCall: number,
        cancel: vscode.CancellationToken
    ): Promise<Set<string>> {
        const types = new Set<string>();
        if (cancel.isCancellationRequested || recursiveCall >= maxRecursiveCalls) {
            return types;
        }
        const definitionPos = await this.sendDefinitionRequest(document, positionOffset);
        if (definitionPos !== null && definitionPos.length > 0) {
            const definitions = transformToLine(definitionPos);
            for (const definition of definitions) {
                const defTypes = await this.transformAlias(
                    definition.location.uri,
                    definition.text,
                    definition.location.range.start,
                    definition.offset,
                    cancel
                );
                defTypes?.forEach(type => types.add(type));
            }
            return splitContainers(types);
        } else {
            // check hover information if we don't need to perform further search
            const hovTypes = await this.transformAlias(
                document.uri,
                document.getText(),
                document.positionAt(positionOffset),
                positionOffset,
                cancel
            );
            hovTypes?.forEach(type => types.add(type));
            if (types.size > 0) {
                return splitContainers(types);
            }
        }

        if (cancel.isCancellationRequested) {
            return types;
        }
        const symbolAtCursorPosition = getSymbolAtPosition(positionOffset, text);
        if (symbolAtCursorPosition === undefined) {
            // not a symbol
            return new Set<string>();
        }
        const query = SymbolToString(symbolAtCursorPosition);
        let allSymbols = (await this.sendAllSymbols(query)) || [];
        let containers = new Set<string>();
        allSymbols = sortedDocumentSymbol(
            document.uri.toString(),
            allSymbols,
            symbolAtCursorPosition.symbol,
            symbolAtCursorPosition.container,
            containers,
            symbolAtCursorPosition.args
        );

        if (allSymbols === undefined || allSymbols.length === 0) {
            return new Set<string>();
        }
        if (symbolAtCursorPosition.container === undefined) {
            // root element, no containers found
            return this.transformToTypes(allSymbols, cancel);
        }
        if (allSymbols.length > 1) {
            containers = await this.provideContainer(
                symbolAtCursorPosition.offset,
                text,
                document,
                recursiveCall + 1,
                cancel
            );
        }
        allSymbols = sortedDocumentSymbol(
            document.uri.toString(),
            allSymbols,
            symbolAtCursorPosition.symbol,
            symbolAtCursorPosition.container,
            containers,
            symbolAtCursorPosition.args
        );

        return this.transformToTypes(allSymbols, cancel);
    }

    private async transformAlias(
        uri: vscode.Uri,
        text: string,
        position: vscode.Position,
        offset: number,
        cancel: vscode.CancellationToken
    ) {
        const hovers = (await this.sendHoverRequestFromText(uri, text, position, cancel)) || [];
        const types = new Set<string>();
        for (const hover of hovers) {
            if (cancel.isCancellationRequested) {
                return types;
            }
            const type = parseVariableType(hover)?.type;
            if (type !== undefined) {
                const posOffset = findLeftTypePattern(text, offset);
                const typeInText = parseVariableType(text, posOffset);
                if (
                    typeInText?.type !== undefined &&
                    removeOptionalFromType(type) === removeOptionalFromType(typeInText.type) &&
                    typeInText.offset !== undefined
                ) {
                    const possibleTypeAliasHover =
                        (await this.sendHoverRequestFromText(
                            uri,
                            text,
                            getPosition(text, typeInText.offset),
                            cancel
                        )) || [];
                    for (const typeAlias of possibleTypeAliasHover) {
                        if (cancel.isCancellationRequested) {
                            return types;
                        }
                        const newType = parseVariableType(typeAlias)?.type;
                        if (newType) {
                            types.add(newType);
                        }
                    }
                } else {
                    types.add(type);
                }
            }
        }
        return types;
    }

    private async transformToTypes(
        allSymbols: langclient.SymbolInformation[],
        cancel: vscode.CancellationToken
    ) {
        const types = new Set<string>();
        if (allSymbols.length > maxNumberOfSymbolsToCheckOnTypes) {
            // limit, otherwise it too long anyway to wait
            return types;
        }
        for (const location of transformToLine(symbolToLocation(allSymbols))) {
            if (cancel.isCancellationRequested) {
                return types;
            }
            const defTypes = await this.transformAlias(
                location.location.uri,
                location.text,
                location.location.range.start,
                location.offset,
                cancel
            );

            defTypes?.forEach(type => types.add(type));
        }
        return splitContainers(types);
    }

    private async sendAllSymbols(query: string) {
        const client = await this.lspClient.client();
        const result = await client.sendRequest(langclient.WorkspaceSymbolRequest.method, {
            query: query,
        });
        const documentSymbol = result as langclient.SymbolInformation[];

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

    private async sendHoverRequestFromText(
        uri: vscode.Uri,
        text: string,
        hoverPos: vscode.Position,
        cancel: vscode.CancellationToken,
        isRecursiveCall = false
    ): Promise<string[] | null> {
        if (cancel.isCancellationRequested) {
            return null;
        }

        const hoverParams: langclient.HoverParams = {
            textDocument: { uri: uri.toString() },
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
        } catch (error) {
            // code: -32001
            const langId = languageId(uri.fsPath);
            if (
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                error.code === -32001 &&
                isRecursiveCall === false &&
                langId !== undefined
            ) {
                const didOpenParam: langclient.DidOpenTextDocumentParams = {
                    textDocument: {
                        uri: uri.toString(),
                        languageId: langId,
                        text: text,
                        version: -100000, // use negative to not interfere with vs code
                    },
                };

                try {
                    const client = await this.lspClient.client();
                    await client.sendNotification(
                        langclient.DidOpenTextDocumentNotification.method,
                        didOpenParam
                    );
                } catch {
                    return null;
                }
                return await this.sendHoverRequestFromText(uri, text, hoverPos, cancel, true);
            }

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

function symbolToLocation(symbols: langclient.SymbolInformation[]) {
    return symbols.map(e => {
        const uri = vscode.Uri.parse(e.location.uri.toString());
        return new vscode.Location(uri, e.location.range as vscode.Range);
    });
}

function getPosition(text: string, offset: number): vscode.Position {
    let line = 0,
        ch = 0;
    const end = Math.min(offset, text.length);
    for (let i = 0; i < end; ++i) {
        if (text[i] === "\n") {
            line++;
            ch = 0;
        } else {
            ++ch;
        }
    }
    return new vscode.Position(line, ch);
}

function transformToLine(locations: vscode.Location[]) {
    return locations.map(e => {
        const document = vscode.workspace.textDocuments
            .filter(doc => doc.uri.fsPath === e.uri.fsPath)
            .at(0);
        let text: string | undefined;
        let offset = 0;
        if (document) {
            // document was edited, check the cached version
            text = document.getText();
            offset = document.offsetAt(e.range.start);
        } // else this doc file is not open, fine to read it from a disk
        if (text === undefined) {
            text = fs.readFileSync(e.uri.fsPath).toString();
            for (let line = 0, ch = 0; offset < text.length; ++offset) {
                if (line === e.range.start.line && ch === e.range.start.character) {
                    break;
                }
                if (text[offset] === "\n") {
                    ++line;
                    ch = 0;
                } else {
                    ++ch;
                }
            }
        }

        if (document) {
            const ff = document.offsetAt(e.range.start);
            if (ff !== offset) {
                console.log("wrong");
            }
        }

        return { location: e, offset: offset, text: text };
    });
}

function filtered(
    list: langclient.SymbolInformation[],
    mapper: (val: langclient.SymbolInformation) => boolean
) {
    const result = list.filter(mapper);
    if (result.length > 0) {
        return result;
    }
    return list;
}

function fuseSearch(
    documentSymbols: langclient.SymbolInformation[],
    name: string,
    args: string[],
    containers: Set<string>
) {
    const fuseOptions = {
        keys: ["name"],
        isCaseSensitive: true,
        shouldSort: true,
        includeScore: true,
        ignoreLocation: false,
        findAllMatches: true,
        location: 0,
        distance: 20,
        minMatchCharLength: 2,
        // useExtendedSearch: true,
    };
    const listOfContainers = [];
    for (const container of containers) {
        listOfContainers.push({ containerName: `${container}` }); // exact match
    }

    if (listOfContainers.length > 0) {
        // in case of having container, we just display all results in containers
        fuseOptions.keys = ["containerName"];
        const result = new Fuse(documentSymbols, fuseOptions)
            .search({ $or: listOfContainers })
            .filter((item: any) => {
                return item.score < 0.3;
            })
            .map((item: any) => {
                return item.item;
            });
        return result;
    } else {
        let query = `${name}`;
        if (args.length > 0) {
            query += `(${args.map(e => `${e}:`).join("")})`;
        }
        const result = new Fuse(documentSymbols, fuseOptions)
            .search(query)
            .filter((item: any) => {
                return item.score < 0.3 || containers.has(item.item.containerName);
            })
            .map((item: any) => {
                return item.item;
            });
        return result;
    }
}

function sortedDocumentSymbol(
    symbolUrl: string,
    documentSymbols: langclient.SymbolInformation[],
    name: string,
    varName: string | undefined,
    containers: Set<string>,
    args: string[]
) {
    // console.log(fuse);
    // check if there's exact match
    documentSymbols = fuseSearch(documentSymbols, name, args, containers);
    documentSymbols = documentSymbols.filter(e => {
        const length = name.length;
        // name should strictly be the same, the exception could be if it's a name of method or a property
        if (e.name.at(length) !== undefined && e.name.at(length) !== "(") {
            return false;
        }
        if (e.name.slice(0, length) !== name) {
            return false;
        }
        if (e.kind === langclient.SymbolKind.TypeParameter) {
            // typeParameter, sourcekit-lsp returns 26 for type in method definition
            return false;
        }
        return true;
    });
    if (name === "init") {
        // likely constructor
        documentSymbols = filtered(documentSymbols, e => {
            return e.kind === langclient.SymbolKind.Constructor;
        });
    }
    if (args.length === 0 && (containers.size !== 0 || varName !== undefined)) {
        /// likely property or field
        documentSymbols = filtered(documentSymbols, e => {
            switch (e.kind) {
                case langclient.SymbolKind.Property:
                case langclient.SymbolKind.Field:
                    return true;
                default:
                    return false;
            }
        });
    }
    if (args.length > 0) {
        // likely method
        documentSymbols = filtered(documentSymbols, e => {
            return (
                e.kind === langclient.SymbolKind.Method || e.kind === langclient.SymbolKind.Function
            );
        });
    }
    documentSymbols = filtered(documentSymbols, e => {
        return e.location.uri.toString() === symbolUrl;
    });
    return documentSymbols;
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

function movePosIfTextEqual(
    text: string,
    pos: number,
    str: string[] | string,
    direction: "right" | "left" = "right"
) {
    if (str instanceof Array) {
        for (const s of str) {
            if (direction === "right") {
                if (text.slice(pos, pos + s.length) === s) {
                    return pos + s.length;
                }
            } else {
                if (text.slice(pos - s.length + 1, pos + 1) === s) {
                    return pos - s.length + 1;
                }
            }
        }
        return pos;
    }
    if (direction === "right") {
        return text.slice(pos, pos + str.length) === str ? pos + str.length : pos;
    } else {
        return text.slice(pos - str.length + 1, pos + 1) === str ? pos - str.length + 1 : pos;
    }
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
    let startOffset: number | undefined = undefined;
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
        if ("\r\n{:,;()=".includes(text[pos])) {
            break;
        }
        if (startOffset === undefined) {
            startOffset = pos;
        }
        result += text[pos];
    }
    return { type: result.replaceAll(/\s/g, "").replaceAll("`", ""), offset: startOffset };
}

function removeOptionalFromType(type: string) {
    while (type.length > 0 && type.at(-1) !== undefined && "?!".includes(type.at(-1) || "")) {
        type = type.slice(0, -1);
    }
    return type;
}

function findLeftTypePattern(text: string, offset: number) {
    let nextI = offset;
    for (let i = offset; i >= 0; --i) {
        nextI = movePosIfTextEqual(text, i, ["init", "case "], "left");
        if (nextI !== i) {
            return undefined;
        }
        nextI = movePosIfTextEqual(text, i, ["let ", "var "], "left");
        if (nextI !== i) {
            return nextI;
        }
        nextI = movePosIfTextEqual(text, i, "func ", "left");
        if (nextI !== i) {
            return nextI;
            continue;
        }

        nextI = movePosIfTextEqual(text, i, "typealias ", "left");
        if (nextI !== i) {
            return nextI;
        }

        nextI = movePosIfTextEqual(text, i, ["class ", "struct ", "enum ", "protocol "], "left");
        if (nextI !== i) {
            return nextI;
        }
    }
}

function parseVariableType(text: string, offset = 0) {
    const commented = preCalcCommentedCode(text);
    let state: "var" | "typealias" | "type" | "func" | "funcReturn" | "none" = "none";
    let nextI = offset;
    for (let i = offset; i < text.length; i = nextI) {
        switch (state) {
            case "none":
                nextI = movePosIfTextEqual(text, i, ["init", "case "]);
                if (nextI !== i) {
                    return undefined;
                }
                nextI = movePosIfTextEqual(text, i, ["let ", "var "]);
                if (nextI !== i) {
                    state = "var";
                    continue;
                }
                nextI = movePosIfTextEqual(text, i, "func ");
                if (nextI !== i) {
                    state = "func";
                    continue;
                }

                nextI = movePosIfTextEqual(text, i, "typealias ");
                if (nextI !== i) {
                    state = "typealias";
                    continue;
                }

                nextI = movePosIfTextEqual(text, i, ["class ", "struct ", "enum ", "protocol "]);
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
                    return { type: "Void", offset: undefined };
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
                } else if (text[i].match(/[a-z|A-Z|0-9|_]/) === null) {
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
    if (symbol === undefined || isKeyword(symbol?.token)) {
        return undefined;
    }

    const argumentDot = argumentPos(symbol.token, text, symbol.start, symbol.end, commented);
    let container: { token: string; start: number; end: number } | undefined = undefined;
    let args: { args: string[]; end: number } | undefined;
    if (argumentDot === undefined) {
        // not an argument
        // parse arguments and container
        container = parseContainer(symbol.start - 1, text, commented);
        if (isKeyword(container?.token)) {
            container = undefined;
        }
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

function isKeyword(keyWord: string | undefined) {
    switch (keyWord) {
        case "return":
        case "case":
        case "for":
        case "if":
        case "guard":
        case "switch":
        case "else":
        case "let":
        case "var":
        case "class":
        case "struct":
        case "enum":
        case "protocol":
        case "func":
        case "_":
            return true;
    }
    return false;
}

export const _private = {
    getSymbolAtPosition,
    parseVariableType,
    splitContainers,
    findLeftTypePattern,
    getPosition,
};
