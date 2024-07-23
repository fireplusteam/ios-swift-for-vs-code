#!/bin/bash

pyinstaller --onefile src/XCBBuildServiceProxy/XCBBuildService.py

# insall dependencies or update them
npm install # resolve dependencies
npm run compile
vsce package

code --install-extension vscode-ios-0.0.9.vsix
