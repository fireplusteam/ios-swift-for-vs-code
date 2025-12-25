#!/bin/bash

# insall dependencies or update them
npm install # resolve dependencies
npm install --save @types/ps-tree
npm install --save @types/find-process
npm install --save @types/lockfile
npm install vscode-languageserver-protocol
npm install vscode-languageclient
npm install @vscode/test-cli
npm install --save-dev sinon @types/sinon

pip install psutil
pyinstaller --onefile src/XCBBuildServiceProxy/XCBBuildService.py

npm run compile
npm run test

# locally package and install the extension
vsce package --target darwin-arm64
vsce package
code --install-extension vscode-ios-0.6.3.vsix

# to publish the extension, uncomment the following line
# https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions
# vsce publish --target darwin-arm64 darwin-x64
# vsce publish 