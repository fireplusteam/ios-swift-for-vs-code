import * as vscode from "vscode";

export async function askIfDebuggable() {
    const option = await vscode.window.showQuickPick(["Debug", "Run"]);
    return option === "Debug";
}

export function getLastLine(stdout: string) {
    stdout = stdout.trim();
    const lines = stdout.split("\n");
    return lines[lines.length - 1];
}