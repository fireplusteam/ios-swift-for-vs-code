#!/bin/bash
source '.vscode/.env'

echo "BIND THE FOLLOWING:"
echo "$PROJECT_FILE"
echo "$SCHEME"
echo "$VS_IOS_XCODE_BUILD_SERVER_PATH"

TYPE=$(if [[ $PROJECT_FILE == *.xcodeproj ]]; then echo "-project"; elif [[ $PROJECT_FILE == *.swift ]]; then echo "-package"; else echo "-workspace"; fi)

"$VS_IOS_XCODE_BUILD_SERVER_PATH/xcode-build-server" config -scheme "$PROJECT_SCHEME" "$TYPE" "$PROJECT_FILE"