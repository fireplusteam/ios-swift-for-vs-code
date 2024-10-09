import * as vscode from "vscode";

function showErrorOnPerformingExtensionCommand() {
    vscode.window
        .showErrorMessage(
            "To use this command you need to select Xcode project. Try It?",
            "Select Xcode Project",
            "Cancel"
        )
        .then(option => {
            if (option === "Select Xcode Project") {
                vscode.commands.executeCommand("vscode-ios.project.select");
            }
        });
}

export function activateNotActiveExtension(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.tools.install",
            showErrorOnPerformingExtensionCommand
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.tools.update",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.lsp.restart",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.env.open.xcode",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.project.selectTarget",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.project.selectConfiguration",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.project.selectDevice",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.check.workspace",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.check.generateXcodeServer",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.build.clean",
            showErrorOnPerformingExtensionCommand
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.build.selectedTarget",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.build.tests",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.run.app.multiple.devices",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.run.app.debug",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.project.file.add",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.project.delete.reference",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.project.file.edit.targets",
            showErrorOnPerformingExtensionCommand
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "vscode-ios.run.project.reload",
            showErrorOnPerformingExtensionCommand
        )
    );
}
