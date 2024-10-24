import * as vscode from "vscode";
import { quickPickWithHistory } from "./quickPickHistory";
import { UserTerminatedError } from "./CommandManagement/CommandContext";

export async function askIfDebuggable() {
    const items: QuickPickItem[] = [
        { label: "Debug", value: "Debug" },
        { label: "Run", value: "Run" },
    ];
    const option = await showPicker(items, "Debug?", "", false, false, true);
    return option === "Debug";
}

export async function askIfBuild() {
    const items: QuickPickItem[] = [
        { label: "Yes", value: "Yes" },
        { label: "No", value: "No" },
    ];
    const option = await showPicker(
        items,
        "Prebuild before launch?",
        "(Esc) to cancel",
        false,
        false,
        true
    );
    if (option === undefined) {
        throw UserTerminatedError;
    }
    return option === "Yes";
}

export async function initializeWithError(error: unknown) {
    const option = await vscode.window.showErrorMessage(
        `Projects can not be initialized. ${error}. Open in Xcode and fix it first!`,
        "Open in Xcode",
        "Cancel"
    );
    if (option === "Open in Xcode") {
        vscode.commands.executeCommand("vscode-ios.env.open.xcode");
    }
}

let extContext: vscode.ExtensionContext;

export function setContext(context: vscode.ExtensionContext) {
    extContext = context;
}

export interface QuickPickItem extends vscode.QuickPickItem {
    value: string | any;
}

export async function showPicker(
    json: string | QuickPickItem[],
    title: string,
    placeholder: string,
    canPickMany = false,
    ignoreFocusOut = false,
    useHistory = false
) {
    let items: QuickPickItem[];
    if (typeof json === "string" || json instanceof String) {
        items = JSON.parse(json as string);
    } else {
        items = json;
    }

    const selectionClosure = async (items: QuickPickItem[]) => {
        return await vscode.window.showQuickPick<QuickPickItem>(items, {
            title: title,
            placeHolder: placeholder,
            ignoreFocusOut: ignoreFocusOut,
            canPickMany: canPickMany,
        });
    };
    let selection: vscode.QuickPickItem | undefined;
    if (useHistory) {
        selection = await quickPickWithHistory(items, extContext, title, selectionClosure);
    } else {
        selection = await selectionClosure(items);
    }

    if (selection === undefined) {
        return undefined;
    }

    let value: string | any | undefined;

    if (typeof selection === "string") {
        value = selection as string;
    }

    if (typeof selection === "object") {
        if (selection === null) {
            value = undefined;
        } else {
            if (canPickMany) {
                const array = (selection as unknown as { [key: string]: any }[]).map(e => {
                    return e["value"];
                });

                value = array;
            } else {
                const dict = selection as { [key: string]: any };
                value = dict["value"];
            }
        }
    }

    return value;
}
