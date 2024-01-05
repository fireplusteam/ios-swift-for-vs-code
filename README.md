# ios_vs_code
Write/Debug/Build iOS app on Visual Studio Code

# Required VS Code extensions:
   CodeLLDB
   Swift - official extension

# Configure xCode Server to make autocompletion work in Visual Studio
original url: https://wojciechkulik.pl/ios/how-to-develop-ios-and-macos-apps-in-other-ides-like-neovim-or-vs-code

1. Build your project in Xcode.
2. Download or clone the repository of xcode-build-server -> https://github.com/SolaWing/xcode-build-server. 
3. Create a link file to xcode-build-server file from the downloaded directory:

   In the shell perform the following command:
```bash
ln -s PATH/TO/xcode-build-server /usr/local/bin
```

4. Navigate to your project and run the following command:

```bash
xcode-build-server config -scheme <XXX> -workspace *.xcworkspace
```
   OR:
```bash
xcode-build-server config -scheme <XXX> -project *.xcodeproj
```

   Note: *.xcworkspace or *.xcodeproj should be unique. can be omit and will auto choose the unique workspace or project.
   Note: current solution works only with xcworkspace


5. Open the directory with your iOS project in Visual Studio Code. Autocompletion should work automatically.

# Setup Keyboard Binding to Build And Run (Optional)

1. In VS Code tap ⇧⌘P then enter "Open Keyboard Shortcuts (JSON)"

2. Place your key bindings in this file to override the defaults

```json
[
    {
        "key": "cmd+r",
        "command": "workbench.action.tasks.runTask",
        "args": "Run iOS App"
    }
]
```
So cmd+shift+b builds your project and cmd+r runs in on simulator, as in xCode
F5 attach debug lldb
Shift+F5 stop debug

So each time after you run the app, you need to attach the debugger manually if you need. 
This gives you a speed on launching app and attaching lldb only in cases when you have to debug

# Setting Vim (Optional)
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
