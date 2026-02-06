#!/bin/bash

# insall dependencies or update them
npm install # resolve dependencies

# remove cached python files for build service
rm -rf src/XCBBuildServiceProxy/__pycache__
rm -rf src/XCBBuildServiceProxy/lib/psutil/__pycache__

# compile and run tests
npm run compile
npm run test

# locally package and install the extension
vsce package --target darwin-arm64
vsce package
code --install-extension vscode-ios-0.7.0.vsix

# to publish the extension, uncomment the following line
# https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions
# vsce publish --target darwin-arm64 darwin-x64
# vsce publish 