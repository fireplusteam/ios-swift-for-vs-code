# vscode-ios README

Write/Build/Debug/Test your xCode projects in VS Code with your favorite extensions

## Features

- Swift/Objective-C/C++ autocompletion
- Compatibility with CodeLLDB
- Debug/Run iOS app
- Debug/Run unit/snapshot tests. Support running single/multiple tests for a class/target/set of classes
- Run an application on multiple simulator with a single command
- Support project/workspace and iOS Package.swift
- Support launch configuration for app
- Support diff snapshots testing
- Add/Delete/Rename/Move files/folders inside vscode
- VS Code workspace generation based on Xcode project/workspace
- Parsing build/test logs and display in Problems panel in real time

Instead of xCode preview you can use hot reloading [InjectionIII](https://github.com/johnno1962/InjectionIII) which works great with this extension:

- HotReloading & Injection with [HotReloading](https://github.com/johnno1962/HotReloading)
- SwiftUI injection property wrapper with [Inject](https://github.com/krzysztofzablocki/Inject) or [HotSwiftUI](https://github.com/johnno1962/HotSwiftUI)

## Requirements

To use this extension you need to install also:

- [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb)
- [Swift](https://marketplace.visualstudio.com/items?itemName=sswg.swift-lang)
- [Python Debugger](https://marketplace.visualstudio.com/items?itemName=ms-python.debugpy) - needed to run the app not in the debug mode
- **Xcode**

- **xcbeautify** tool to prettify the building log output:

  ```bash
  brew install xcbeautify
  ```

- **xcodeproj** gem library to make possible to add/delete/rename files in your Xcode project directly from vs code.

  ```bash
  gem install xcodeproj
  ```

**Note:**
As [sourcekit-lsp](https://github.com/apple/sourcekit-lsp) updates indexes while building, If you want to have indexes updating even if you have compile errors, you need to give **a full disk control** to Visual Studio Code in Security Settings which allows to install a proxy service for Apple **XCBBuildService** automatically when an extension is activated.
This's just needed to override the **continueBuildingAfterError** property when you build the app and gives you all errors in the project and compile flags possible used by sourcekit for indexing.

## How to build/install extension from a repo

Open terminal to install required libraries (Also make sure you've installed Xcode, xcbeautify, xcodeproj):

- install **pyinstaller** and **psutil** (needed to build Xcode proxy build service)

```bash
pip install pyinstaller
pip install psutil
```

- install **npm**

```bash
brew install node
```

- clone git repo and update submodules:

```bash
git clone https://github.com/fireplusteam/ios_vs_code.git
git submodule update --init --recursive
```

- install vsce package

```bash
brew install vsce
```

- 1. Open Visual Studio Code.
  2. Press **Cmd+Shift+P** to open the Command Palette.
  3. Type: **Shell Command: Install 'code' command in PATH**.

- navigate to repo folder in your terminal and run:

```bash
./make.sh
```

If everything configured right, the extension should be built and installed to vs code automatically.

## Extension Settings

This extension contributes the following settings:

- `vscode-ios.watcher`: Enable/disable the autocomplete watch build to update indexes whenever a new file added/renamed/moved/deleted/etc.

## Known Issues

- You still need Xcode to use SwiftUI preview or edit storyboard/assets/project settings.
- [sourcekit-lsp](https://github.com/apple/sourcekit-lsp) use indexing while build. if you find definition or references is not work correctly, just build it to update index or restart Swift LSP in VS Code.
- When running for the first time, **you need to ensure that the log is complete**, otherwise some files cannot obtain the correct flags.

## Release Notes

### 0.0.1

It's still under development, so you can face some bugs
