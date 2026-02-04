# Swift iOS Xcode IDE<img valign="middle" alt="Swift iOS Xcode IDE logo" width="40" src="./icons/icon.png" />

📦[VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=FirePlusTeam.vscode-ios) | 🐞
[Github Issues](https://github.com/fireplusteam/ios_vs_code/issues)

You can support this project by giving a star on GitHub ⭐️

[![GitHub](https://img.shields.io/github/stars/fireplusteam/ios_vs_code?style=social)](https://github.com/fireplusteam/ios_vs_code)

---

Develop/Build/Debug/Test your Xcode projects in VS Code with your favorite extensions for iOS/macOS/watchOS/tvOS/VisionOS using Swift/Objective-C/C++.

Before use it make sure you've installed all **dependencies** required for this extension.

## Extension Activation

To activate extension you need to open a folder which contains your Xcode project/workspace or Package.swift file and perform command **"Xcode: Select Project/Workspace"** to pick the project/workspace to work with. **Until you select the project/workspace/Package.swift file, extension will not be activated**. Create `launch.json` and `tasks.json` and `settings.json` files in `.vscode` folder if they don't exist to add launch configurations, tasks and settings for your project. By default it adds `Xcode Workspace: Run App & Debug` launch configuration for debugging/running the app.

---

## ✅ Autocomplete

[![Autocomplete](media/autocomplete.gif)](https://youtu.be/0dXQGY0IIEA)

## Features

- Supports iOS/MacOS/WatchOS/VisionOS/TvOS
- Supports Package.swift via tuist project generation (only Package.swift in the root folder is supported)
- Swift/Objective-C/C++ autocompletion
- Compatibility with CodeLLDB/lldb-dap
- Debug/Run app on Simulators (physical device is currently is not supported)
- Debug/Run unit/snapshot/UI tests/test plans. Support running single/multiple tests for a class/target/set of classes/subprojects
- Support code coverage
- Run an application on multiple simulator with a single command
- Support project/workspace
- Support launch configuration for app
- Support diff snapshots testing
- Add/Delete/Rename/Move files/folders inside vscode and reflect changes in Xcode project
- VS Code workspace generation based on Xcode project/workspace
- Parsing build/test logs and display in real time
- File tree explorer based on Xcode project structure

Instead of xCode preview you can use hot reloading [InjectionIII](https://github.com/johnno1962/InjectionIII) which works great with this extension:

- HotReloading & Injection with [HotReloading](https://github.com/johnno1962/HotReloading)
- SwiftUI injection property wrapper with [Inject](https://github.com/krzysztofzablocki/Inject) or [HotSwiftUI](https://github.com/johnno1962/HotSwiftUI)

To Debug View Hierarchy you can use this technique [How to debug your view hierarchy using recursiveDescription](https://www.hackingwithswift.com/articles/101/how-to-debug-your-view-hierarchy-using-recursivedescription)

## Keybindings

- alt+o - switch between header and source files for C/C++/ObjC files like in Visual Studio

## Formatting

That extension provides built-in support for formatting Swift files using 'swift-format' tool from Apple. It's only available if you set it as default formatter for Swift files in VS Code settings and turns on format on save:

```json
{
    "[swift]": {
        "editor.defaultFormatter": "fireplusteam.vscode-ios"
    },
    "editor.formatOnSave": true,
    "editor.formatOnType": true // optional, to format while typing like in Xcode
}
```

if you want to use 'swiftformat' tool, you need to install a separate extension [XCode Swift Formatter](https://marketplace.visualstudio.com/items?itemName=FirePlusTeam.vscode-swiftformat-xcode) or similar which provides the integration with 'swiftformat' tool and also supports formatting on save and on type.

## Dependencies

Before an extension is activated, there's a automatic check if those dependencies are installed and if not, it's ask a user to install them automatically.
Use the following guide to install them manually if any it doesn't work for you:

**Required Dependencies**:

- 🍏 **MacOS** — Other platforms are currently not supported
- 📱 **Xcode** and simulators. Make sure that your Xcode is installed in `/Application/Xcode/` folder

- **homebrew**:

    ```bash
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    ```

- **xcbeautify** tool to prettify the building log output:

    ```bash
    brew install xcbeautify
    ```

- **tuist** tool to generate Xcode workspace for `Package.swift`:

    ```bash
    brew install tuist
    ```

- **xcodeproj** gem library to make possible to add/delete/rename files in your Xcode project directly from vs code.

    ```bash
    brew install ruby # if you don't have ruby installed, but it's preinstalled on macOS
    gem install xcodeproj
    ```

- **pyinstaller** tool to build SWBBuildServiceProxy if you want to enable that feature (optional and only if you enable swb build service proxy feature in settings):

    ```bash
    brew install pyinstaller
    ```

## How to use

- Once you installed all the dependencies, you can open a folder which contains the iOS project. If project or workspace is located in the local folder then an extension will ask you if you want to configure it, otherwise you need to perform command **"Xcode: Select Project/Workspace"** and pick the right project/workspace to work with. You can also switch between multiple projects if they are located in the same folder/subfolders

## Launching and Debugging

- There's ios launch configuration that can be added to `launch.json` file to run and debug ios project located in '.vscode' folder (there's also `Xcode: Run App & Debug` snippet)

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

### Parameters

- `target`: should be only "app"
- `isDebuggable`: if true, it will launch the app in debug mode, otherwise in run mode
- `buildBeforeLaunch`: can be
  - "always" to always build before launching
  - "never" to never build before launching
  - "ask" to ask a user if the build is required before launching
- `lldbCommands`: array of lldb commands to execute on debugger start

## User Defined Tasks

Extensions adds the tasks for clean/build/autocomplete watcher tasks which a user may override and add extra configuration as a regular vs code task in 'tasks.json' file located in '.vscode' folder:

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
            // add targets which you want watcher to include for each run to improve autocompletion.
            // For example, you can add AGGREGATE targets which build all targets you need for autocompletion
            "includeTargets": ["someTestTarget", ...],
            // exclude targets which you want definitely exclude from building,
            // for example targets which execute scripts only
            "excludeTargets": ["someTargetWhichExecuteScripts", ...]
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

- Also there're automatically added build tasks which can be used by pressing standard "**Cmd+Shift+B**" shortcut. If you have other building tasks, you need to add one of the above building tasks to your `tasks.json` file to make it work.

- To make autocompletion to work you may need to clean the project and build it entirely for the first time.

## SWBBuildService Proxy (Continue Building After Error while building for LSP Autocomplete)

**READ THIS SECTION CAREFULLY BEFORE ENABLING THIS FEATURE AND MAKE SURE YOU UNDERSTAND ALL THE RISKS.**

This feature is optional and EXPERIMENTAL and disabled by default but it provides **fast incremental builds** as in Xcode due to not terminated SWBBuildService session between builds. It requires sudo password and security permissions to work correctly. Use it on your own risk. Also make sure that you read the instructions below carefully before enabling it.
Also you can build that proxy service from source code in `src/Services/SWBBuildServiceProxy` folder by cd into that folder and running:

```bash
brew install pyinstaller
pyinstaller --onefile "PATH_TO_GIT_EXTENSION_REPO/src/XCBBuildServiceProxy/SWBBuildService.py" --distpath "PATH_TO_SAVE_BINARY/dist"
```

Then you need to copy the generated binary from `PATH_TO_SAVE_BINARY/dist/SWBBuildService` to `Application/Xcode.app/Contents/Developer/SharedFrameworks/SwiftBuild.framework/Versions/A/PlugIns/SWBBuildService.bundle/Contents/MacOS` path to make it work or create a symlink like extension does.

Or you can just **enable the feature in the settings and let the extension do it for you automatically**. It utilizes `pyinstaller` to build the proxy service on the fly and resign it with your signing identity to avoid macOS security issues.

As [sourcekit-lsp](https://github.com/apple/sourcekit-lsp) updates indexes while building, If you want to have indexes updating even if you have compile errors, you need to give **a full disk control** to Visual Studio Code in Security Settings which allows to install a proxy service for Apple **SWBBuildService** automatically when an extension is activated.
This's just needed to override the **continueBuildingAfterError** property when you build the app and gives you all errors in the project and compile flags possible used by sourcekit for indexing. This behaviour is only activated for `watcher` builds which are used to provide up-to-date indexes for LSP client while you modify files in the project. Regular builds/debugging runs are not affected by this proxy service and works as usual.

When you enable `vscode-ios.swb.build.service` feature in the settings, the extension will ask you for your sudo password to install the proxy service. This is required because the service needs to run with elevated privileges to replace the original SWBBuildService in Xcode app folder which is called by `xcodebuild` tool each time when you build.

The following message should not be happen but if you get it you should either **rebuild** proxy service to refresh signature or do the next steps: When you run the first time after enabling this feature and installing the service, you may face the alert pop-up that the app is blocked from opening. To fix it, you need to follow those steps to allow the service to run:

### Privacy & Security Settings

1. Attempt to open the app and click `Done` on the alert pop-up.
2. Go to `System Settings > Privacy & Security`.
3. Scroll down to the `Security` section.
4. Click `Open Anyway` next to the message about the blocked app.
5. Enter your administrator password to confirm.
6. Try to build app again and confirm that you want to open the service.

Now the service should be running and you can check it via Activity Monitor app by searching for `SWBBuildService` and `SWBBuildService-origin` processes while building the project.

**If you find it's not working or want to restore original service back, at any time you can disable this feature in the settings and the original SWBBuildService will be restored automatically. You can also do it manually by going to the `Application/Xcode.app/Contents/Developer/SharedFrameworks/SwiftBuild.framework/Versions/A/PlugIns/SWBBuildService.bundle/Contents/MacOS` folder and replacing the `SWBBuildService-origin` file back to `SWBBuildService`.**

## Extension Settings

This extension contributes the following settings:

- `vscode-ios.watcher.enabled`: Enable/disable the autocomplete watch build to update indexes whenever a you modified a file.
- `vscode-ios.watcher.jobs`: Number of parallel jobs for xcodebuild watcher which builds the project in background to provide up-to-date indexes for LSP client.
- `vscode-ios.build.compilationCache` : Enable/disable the compilation cache to speed up the building time.
- `vscode-ios.swb.build.service`: if Enabled, it will ask a user sudo password to replace SWBBuildService with a proxy service which would enhance the Autocomplete feature. This's used to continue compile a project even if there's multiple errors, so all flags are updated
- `vscode-ios.lsp.buildIndexesWhileBuilding`: Enable/disable building indexes while building the project to keep indexes up to date.
- `vscode-ios.swiftui.runtimeWarnings`: Enable/disable SwiftUI runtime warnings in the sidebar Xcode panel of this extension.
- `vscode-ios.building.system.mode`: Underline system to use for providing builds/indexes.\n - 'xcodebuild' is using xcodebuild only to provide LSP indexes/build apps/tests (recommended)\n - 'mixedWithXcode' is experimental and you should use on your own risk, this mode uses both Xcode when the project is opened in Xcode too to provide LSP indexes/build apps/tests and xcodebuild is used only when Xcode is closed.
- `vscode-ios.lsp.c_family`: Enable/disable C/C++/Objective-C language server support for header files to provide better autocomplete for such files.
- `vscode-ios.log.level`: Set the logging level for the extension. Possible values are 'debug', 'info', 'warning', 'error', 'critical'.

### Also check [Tricks and Tips](Tricks_and_tips.md)

## Known Issues

- You still need Xcode to use SwiftUI preview or edit storyboard/assets/project settings.
- Running/debugging on device is not currently supported.
- [sourcekit-lsp](https://github.com/apple/sourcekit-lsp) use indexing while build. if you find definition or references is not work correctly, just build it to update index or restart Swift LSP in VS Code.
- When running for the first time, **you need to ensure that the log is complete**, otherwise some files cannot obtain the correct flags.
- If Generating of project is not working as expected or generates some kind of errors if Xcode opens the same project file, you simply need to update **xcodeproj** lib and ruby library to the latest

    ```bash
    gem install xcodeproj
    ```

- Make sure that Package.swift file is in root workspace folder and you open root folder, otherwise LSP client may work incorrectly
- When you use 'mixedWithXcode' building system mode, it may lead to some unpredictable behavior, use it on your own risk
- Xcode folder references are supported only for adding folders,renaming/moving/deleting folder references. Also added some basic support of editing targets for such folder references, but it may not work in some complex cases when you need to add/remove files individually from such folder references in targets.
- If you change some tests in Xcode while VS code is opened, you may need to refresh the test explorer or refresh a cache via "Xcode: Project: Reload" command to reflect the changes in the test explorer as implementing file watcher for tests explorer has performance issues for large projects currently.
- Precompiled headers may cause issues with C++/Objective-C LSP client on incremental builds, so it's disabled when you build with that extension but if you build with Xcode it may still cause the issue. You can set **GCC_PRECOMPILE_PREFIX_HEADER=NO** in your project build settings to avoid that issue with that extension when you use Xcode to build.

## Release Notes

### 0.6.12

It's still under development, so you can face some bugs
