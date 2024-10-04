#!/bin/bash

# insall dependencies or update them
npm install # resolve dependencies
npm install --save @types/ps-tree
npm install --save @types/find-process
npm install --save @types/lockfile
npm install vscode-languageserver-protocol
npm install vscode-languageclient

pip install psutil
pyinstaller --onefile src/XCBBuildServiceProxy/XCBBuildService.py

npm run compile
vsce package

code --install-extension vscode-ios-0.2.1.vsix
