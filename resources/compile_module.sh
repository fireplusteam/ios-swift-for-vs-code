#!/bin/bash
source '.vscode/.env'
source "$VS_IOS_SCRIPT_PATH/xcode_build_util.sh"

mkdir -p .logs

rm -r .vscode/.bundle;

SCHEME=$1

export continueBuildingAfterErrors=True

XCODECMD="xcodebuild -scheme \"$SCHEME\" $XCODECMD -jobs 4"
eval "$XCODECMD build | tee -a '.logs/autocomplete.log'"
echo "Build Sucsseded.■" >> .logs/autocomplete.log