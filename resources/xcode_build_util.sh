#!/bin/bash
source '.vscode/.env'

DESTINATION="id=$DEVICE_ID"

if [ "$VS_IOS_XCODE_SDK" != "" ]; then
    XCODECMD="-configuration \"$PROJECT_CONFIGURATION\" -sdk \"$VS_IOS_XCODE_SDK\" -destination \"$DESTINATION,platform=$PLATFORM\" -resultBundlePath .vscode/.bundle -skipMacroValidation"
else
    XCODECMD="-configuration \"$PROJECT_CONFIGURATION\" -destination \"$DESTINATION,platform=$PLATFORM\" -resultBundlePath .vscode/.bundle -skipMacroValidation"
fi

TYPE=$(if [[ $PROJECT_FILE == *.xcodeproj ]]; then echo "-project"; elif [[ $PROJECT_FILE == *.swift ]]; then echo "-package"; else echo "-workspace"; fi)
# Check if TYPE is non-empty
if [ "$TYPE" != "-package" ]; then
    XCODECMD="$XCODECMD \"$TYPE\" \"$PROJECT_FILE\""
else

    PATH_SCRIPT=$(
        python3 <<EOF
import sys
sys.path.insert(0, "$VS_IOS_SCRIPT_PATH")
import helper

path = helper.get_derived_data_path()
print(path)

EOF
    )

    PATH_SCRIPT=$(echo "$PATH_SCRIPT" | tail -n 1)

    XCODECMD="$XCODECMD -derivedDataPath \"$PATH_SCRIPT\""

fi

mkdir -p .logs
