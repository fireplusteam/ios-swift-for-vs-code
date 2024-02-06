#!/bin/bash
source '.vscode/.env'

DESTINATION="id=$DEVICE_ID"

XCODECMD="-configuration Debug -destination \"$DESTINATION\" -sdk iphonesimulator -resultBundlePath .vscode/.bundle"

TYPE=$(if [[ $PROJECT_FILE == *.xcodeproj ]]; then echo "-project"; elif [[ $PROJECT_FILE == *.swift ]]; then echo "-package"; else echo "-workspace"; fi)
# Check if TYPE is non-empty
if [ "$TYPE" != "-package" ]; then
    XCODECMD="$XCODECMD \"$TYPE\" \"$PROJECT_FILE\""
else

PATH_SCRIPT=$(python3 <<EOF
import sys
sys.path.insert(0, '.vscode')
import helper

path = helper.get_derived_data_path()
print(path)

EOF
)

PATH_SCRIPT=$(echo "$PATH_SCRIPT" | tail -n 1)

XCODECMD="$XCODECMD -derivedDataPath \"$PATH_SCRIPT\""

fi

mkdir -p .logs