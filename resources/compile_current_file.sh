#!/bin/bash
source '.vscode/.env'
source "$VS_IOS_SCRIPT_PATH/xcode_build_util.sh"

mkdir -p .logs

rm .logs/build.log
rm -r .vscode/.bundle;

SELECTED_FILE=$1

SCHEME_SCRIPT=$(python3 <<EOF
import sys
sys.path.insert(0, "$VS_IOS_SCRIPT_PATH")
import helper
import xcutil

scheme = xcutil.get_scheme_by_file_name("$PROJECT_FILE", "$SELECTED_FILE")
print(scheme)

EOF
)

SCHEME=$(echo "$SCHEME_SCRIPT" | tail -n 1)

export continueBuildingAfterErrors=True

if [ "$SCHEME" == "None" ]; then
    if [[ "$SELECTED_FILE" == *.swift ]]; then
        echo "File is not found in target, main target is building instead"
        SCHEME=$PROJECT_SCHEME
    else
        echo "No scheme is found for file: $SELECTED_FILE"
        exit 0
    fi
else
    echo "Scheme found!"
    if [ "$TYPE" != "-package" ]; then
        # file is in project, update single file
        export BUILD_XCODE_SINGLE_FILE_PATH="$SELECTED_FILE"
    fi
fi

rm .logs/build.log

echo "UPDATING INDEXING FOR: ${SCHEME_VALUE}, file: $SELECTED_FILE"

XCODECMD="xcodebuild -scheme \"$SCHEME\" $XCODECMD"
echo "Base XCODECMD: $XCODECMD"
eval "$XCODECMD build" 2> /dev/null | tee -a '.logs/build.log' &> /dev/null 2>&1

python3 "$VS_IOS_SCRIPT_PATH/print_errors.py"