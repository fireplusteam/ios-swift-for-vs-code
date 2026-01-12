# Xcode iOS Swift IDE <img valign="middle" alt="Xcode iOS Swift IDE logo" width="40" src="./icons/icon.png" />

📦[VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=FirePlusTeam.vscode-ios) | 🐞
[Github Issues](https://github.com/fireplusteam/ios_vs_code/issues)

You can support this project by giving a star on GitHub ⭐️

[![GitHub](https://img.shields.io/github/stars/fireplusteam/ios_vs_code?style=social)](https://github.com/fireplusteam/ios_vs_code)
[![Github Sponsors](https://img.shields.io/badge/Github%20Sponsors-%E2%9D%A4-red?style=flat&logo=github)](https://github.com/sponsors/ios_vs_code)

<hr/>
Develop/Build/Debug/Test your xCode projects in VS Code with your favorite extensions.

Before use it make sure you've installed all **dependencies** required for this extension.

## Extension Activation

To activate extension you need to open a folder which contains your Xcode project/workspace or Package.swift file and perform command **"Xcode: Select Project/Workspace"** to pick the project/workspace to work with. **Until you select the project/workspace/Package.swift file, extension will not be activated**.

<hr/>

## ✅ Autocomplete

[![Autocomplete](media/autocomplete.gif)](https://youtu.be/0dXQGY0IIEA)

## Features

-   Supports iOS/MacOS/WatchOS/VisionOS/TvOS
-   Supports Package.swift via tuist project generation (only Package.swift in the root folder is supported)
-   Swift/Objective-C/C++ autocompletion
-   Compatibility with CodeLLDB/lldb-dap
-   Debug/Run app on Simulators (physical device is currently is not supported)
-   Debug/Run unit/snapshot/UI tests/test plans. Support running single/multiple tests for a class/target/set of classes
-   Support code coverage
-   Run an application on multiple simulator with a single command
-   Support project/workspace
-   Support launch configuration for app
-   Support diff snapshots testing
-   Add/Delete/Rename/Move files/folders inside vscode
-   VS Code workspace generation based on Xcode project/workspace
-   Parsing build/test logs and display in real time
-   File tree explorer based on Xcode project structure

Instead of xCode preview you can use hot reloading [InjectionIII](https://github.com/johnno1962/InjectionIII) which works great with this extension:

-   HotReloading & Injection with [HotReloading](https://github.com/johnno1962/HotReloading)
-   SwiftUI injection property wrapper with [Inject](https://github.com/krzysztofzablocki/Inject) or [HotSwiftUI](https://github.com/johnno1962/HotSwiftUI)

To Debug View Hierarchy you can use this technique [How to debug your view hierarchy using recursiveDescription](https://www.hackingwithswift.com/articles/101/how-to-debug-your-view-hierarchy-using-recursivedescription)

## Keybindings

-   alt+o - switch between header and source files for C/C++/ObjC files like in Visual Studio

## Dependencies

Before an extension is activated, there's a automatic check if those dependencies are installed and if not, it's ask a user to install them automatically.
Use the following guide to install them manually if any it doesn't work for you:

**Required Dependencies**:

-   🍏 **MacOS** — Other platforms are currently not supported
-   📱 **Xcode** and simulators. Make sure that your Xcode is installed in `/Application/Xcode/` folder

-   **homebrew**:

    ```bash
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    ```

-   **xcbeautify** tool to prettify the building log output:

    ```bash
    brew install xcbeautify
    ```

-   **tuist** tool to generate Xcode workspace for Package.swift:

    ```bash
    brew install tuist
    ```

-   **xcodeproj** gem library to make possible to add/delete/rename files in your Xcode project directly from vs code.

    ```bash
    brew install ruby # if you don't have ruby installed, but it's preinstalled on macOS
    gem install xcodeproj
    ```

**Note:**
As [sourcekit-lsp](https://github.com/apple/sourcekit-lsp) updates indexes while building, If you want to have indexes updating even if you have compile errors, you need to give **a full disk control** to Visual Studio Code in Security Settings which allows to install a proxy service for Apple **XCBBuildService** automatically when an extension is activated.
This's just needed to override the **continueBuildingAfterError** property when you build the app and gives you all errors in the project and compile flags possible used by sourcekit for indexing.

## How to use

-   Once you installed all the dependencies, you can open a folder which contains the iOS project. If project or workspace is located in the local folder then an extension will ask you if you want to configure it, otherwise you need to perform command **"Xcode: Select Project/Workspace"** and pick the right project/workspace to work with. You can also switch between multiple projects if they are located in the same folder/subfolders

## Launching and Debugging

-   There's ios launch configuration that can be added to `launch.json` file to run and debug ios project (there's also `Xcode: Run App & Debug` snippet)

```json
"configurations": [
    {
        "type": "xcode-lldb",
        "name": "Xcode: Run App & Debug",
        "request": "launch",
        "target": "app",
        "isDebuggable": true,
        "buildBeforeLaunch": "always",
        "lldbCommands": []
    }
]
```

### Parameters:

-   `target`: should be only "app"
-   `isDebuggable`: if true, it will launch the app in debug mode, otherwise in run mode
-   `buildBeforeLaunch`: can be
    -   "always" to always build before launching
    -   "never" to never build before launching
    -   "ask" to ask a user if the build is required before launching
-   `lldbCommands`: array of lldb commands to execute on debugger start

## User Defined Tasks

Extensions adds the tasks for clean/build/autocomplete watcher tasks which a user may override and add extra configuration as a regular vs code task:

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "Xcode Build",
            "type": "xcode",
            "command": "buildSelectedTarget",
            "group": {
                "kind": "build",
                "isDefault": true
            }
        },
        {
            "label": "Xcode Autocomplete",
            "type": "xcode-watch",
            "command": "buildForAutocomplete",
            "group": {
                "kind": "build",
                "isDefault": false
            },
            "includeTargets": ["someTestTarget", ...], // add targets which you want watcher include for each run
            "excludeTargets": ["someTargetWhichExecuteScripts", ...] // exclude targets which you want definitely exclude from building
        },
        {
            "label": "Xcode Clean",
            "type": "xcode",
            "command": "cleanDerivedData",
            "group": {
                "kind": "build",
                "isDefault": false
            }
        }
    ]
}
```

-   Also there're automatically added build tasks which can be used by pressing standard "**Cmd+Shift+B**" shortcut.

-   To make autocompletion to work you may need to clean the project and build it entirely for the first time.

## Extension Settings

This extension contributes the following settings:

-   `vscode-ios.watcher.enabled`: Enable/disable the autocomplete watch build to update indexes whenever a you modified a file.
-   `vscode-ios.swb.build.service`: if Enabled, it will ask a user sudo password to replace XCBBuildService with a proxy service which would enhance the Autocomplete feature. This's used to continue compile a project even if there's multiple errors, so all flags are updated
-   `vscode-ios.building.system.mode`: Underline system to use for providing builds/indexes.\n - 'xcodebuild' is using xcodebuild only to provide LSP indexes/build apps/tests (recommended)\n - 'mixedWithXcode' is experimental and you should use on your own risk, this mode uses both Xcode when the project is opened in Xcode too to provide LSP indexes/build apps/tests and xcodebuild is used only when Xcode is closed.

### Also check [Tricks and Tips](Tricks_and_tips.md)

## Known Issues

-   You still need Xcode to use SwiftUI preview or edit storyboard/assets/project settings.
-   Running/debugging on device is not currently supported.
-   [sourcekit-lsp](https://github.com/apple/sourcekit-lsp) use indexing while build. if you find definition or references is not work correctly, just build it to update index or restart Swift LSP in VS Code.
-   When running for the first time, **you need to ensure that the log is complete**, otherwise some files cannot obtain the correct flags.
-   If Generating of project is not working as expected or generates some kind of errors if Xcode opens the same project file, you simply need to update **xcodeproj** lib and ruby library to the latest

    ```bash
    gem install xcodeproj
    ```

-   Make sure that Package.swift file is in root workspace folder and you open root folder, otherwise LSP client may work incorrectly
-   When you use 'mixedWithXcode' building system mode, it may lead to some unpredictable behavior, use it on your own risk
-   Xcode folder references are supported only for adding folders,renaming/moving/deleting folder references. Also added somebasic support of editing targets for such folder references, but it may not work in some complex cases when you need to add/remove files individually from such folder references in targets.

## Release Notes

### 0.6.6

It's still under development, so you can face some bugs
