#!/bin/bash

# insall dependencies or update them
npm install # resolve dependencies
npm run compile
vsce package

code --install-extension vscode-ios-0.0.1.vsix