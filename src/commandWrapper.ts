import * as vscode from "vscode";
import { ExecutorRunningError, ExecutorTaskError, ExecutorTerminatedByUserError } from "./execShell";
import { projectExecutor, sleep } from "./extension";
import { AutocompleteWatcher } from "./AutocompleteWatcher";
import { TerminatedDebugSessionTask } from "./DebugConfigurationProvider";

export async function runCommand(commandClosure: () => Promise<void>, successMessage: string | undefined = undefined) {
    try {
        await commandWrapper(commandClosure, successMessage);
    } catch (err) {
        // command wrapper shows an error, no more need to propagate it further
    }
}

export async function commandWrapper(commandClosure: () => Promise<void>, successMessage: string | undefined = undefined) {
    try {
        await commandClosure();
        if (successMessage) {
            vscode.window.showInformationMessage(successMessage);
        }
    } catch (err) {
        if (err instanceof ExecutorRunningError) {
            const executingCommand = err.commandName
            let choice: string | undefined;
            if (executingCommand === AutocompleteWatcher.AutocompleteCommandName) {
                choice = "Terminate";
            } else {
                choice = await vscode.window.showErrorMessage(
                    "To execute this task you need to terminate the current task. Do you want to terminate it to continue?",
                    "Terminate",
                    "Cancel"
                );
            }
            if (choice === "Terminate") {
                await projectExecutor.terminateShell();
                await commandClosure();
            } else {
                throw err;
            }
        } else if (err instanceof ExecutorTaskError) {
            const error = err as ExecutorTaskError;
            vscode.window.showErrorMessage(error.message, "Show log")
                .then((option) => {
                    if (option === "Show log") {
                        error.terminal?.show();
                    }
                });
            throw err;
        } else if (err instanceof ExecutorTerminatedByUserError) {
            throw err; // no need to notify as this's one is terminated by user
        } else if (err instanceof TerminatedDebugSessionTask) {
            throw err;
        } else {
            if ((err as Error).message) {
                vscode.window.showErrorMessage((err as Error).message);
            }
            throw err;
        }
    }
}
