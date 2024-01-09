# Bring iOS development to VS Code
##Write/Debug/Build iOS app on Visual Studio Code
   Install Visual Studio Code and required extensions. Also you need python at least 3.9, xCode and xCode Server setup. 
   
   
# Required VS Code extensions:
 ##Required:
   CodeLLDB https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb
   Swift - https://marketplace.visualstudio.com/items?itemName=sswg.swift-lang
   Launch Configs - https://marketplace.visualstudio.com/items?itemName=ArturoDent.launch-config
   Dynamic Input -> https://marketplace.visualstudio.com/items?itemName=igrek8.dynamic-inputs
 ##Optionals
   Python
   Git
   Output Link To File (if you want links to files in output window and terminal)
   Bracket Pair Color DLW
   Output Colorizer
   Vim (if you want powerful editor)
   
# Required Dependencies

```bash
brew install python
```
   

# Configure xCode Server to make autocompletion work in Visual Studio

1. Build your project in Xcode.
2. Download or clone the repository of xcode-build-server -> https://github.com/SolaWing/xcode-build-server. 
3. Create a link file to xcode-build-server file from the downloaded directory:

   In the shell perform the following command:
```bash
ln -s PATH/TO/xcode-build-server /usr/local/bin
```

NOTE: if you want to setup neovim follow this: https://wojciechkulik.pl/ios/how-to-develop-ios-and-macos-apps-in-other-ides-like-neovim-or-vs-code


# Setup Keyboard Binding to Build And Run like in xCode

1. In VS Code tap ⇧⌘P then enter "Open Keyboard Shortcuts (JSON)"

2. Place your key bindings in this file to override the defaults

```json
[
    {
        "key": "cmd+r",
        "command": "workbench.action.tasks.runTask",
        "args": "Run & Debug iOS App"
    },
    {
        "key": "cmd+shift+r",
        "command": "workbench.action.tasks.runTask",
        "args": "Run iOS App"
    },
    {
        "key": "cmd+'",
        "command": "workbench.action.reloadWindow",
        "when": "isDevelopment && !isAuxiliaryWindowFocusedContext"
    }
]
```
3. Change default binding of cmd+r in keyboard preference to cmd+' or what ever you prefer

# Configure/create .vscode/.env file with your project specific keys
Example of .env file, but it should be generated automatically
```
PROJECT_FILE="TestVSCode.xcworkspace"
PROJECT_SCHEME="TestVSCode"
BUNDLE_APP_NAME="puzzle.TestVSCode"
PLATFORM="iOS Simulator"
PLATFORM_OS="17.0.1"
DEVICE_NAME="iPhone 15 Pro"
```

# Usage Guide: VS Code

 1. Copy .vscode folder to you root project folder where xcworkspace file is located
 2. Open root folder which contains root xcworkspace file with VS Code
 3. That's it, but you need to make the first build of app to make autocompletion works correct by pressing cmd+shift+b

##Autocompletion Binding
  if you found that autocompletion is not working, then you need to refresh it by
  cmd+shift+p -> Run Task -> Bind Autocomplete

##Compile
  cmd+shift+b builds your project and refresh the Autocomplete

##Run & Debug on iOS Device
  cmd+r runs in on simulator, as in xCode, also build a project and refresh Autocomplete

##Run Without Debugger Attached on iOS Device
  cmd+shift+r runs in on simulator, as in xCode, also build a project and refresh Autocomplete
  
  
##Debug an earlier launched ios app session
  F5 attach debug lldb
  Shift+F5 stop debug

  You can configure F5 by choosing two options:
    a. Debug iOS App -> runs lldb of the last running process triggered by cmd+r, you need to relaunch debugger after each cmd+r
    b. Show iOS App Log -> displays iOS app stdout/stderr to Debug Console of VS Code. This can be done only once per dev session

  So each time after you run the app, you need to attach the debugger manually if you need. 
  This gives you a speed on launching app and attaching lldb only in cases when you have to debug

##Run Tests
  press cmd+shift+p -> Run Task -> Test iOS App
  
##Select scheme
  cmd+shift+p -> Run Task -> Select Scheme

##Select iOS Simulator/Device
  cmd+shift+p -> Run Task -> Select Destination Device

# Setting Vim (Optional)
Install Vim extension for VS Code

Go to settings.json and add:

```json
"vim.insertModeKeyBindings": [
        { //exit insert mode
          "before": [
            "j",
            "k"
          ],
          "after": [
            "<Esc>"
          ]
    }],
    "keyboard.dispatch": "keyCode"
```

# Other tricks (Optional):

If you want the search to be able to work on hidden files in VS Code, you need to set

"search.useIgnoreFiles": false
