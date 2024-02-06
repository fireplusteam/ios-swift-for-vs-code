#!/bin/bash
source '.vscode/.env'
source '.vscode/xcode_build_util.sh'

export continueBuildingAfterErrors=True

mkdir -p .logs

XCODECMD="xcodebuild -scheme \"$PROJECT_SCHEME\" $XCODECMD"
echo "Base XCODECMD: $XCODECMD"

rm .logs/build.log
rm -r .vscode/.bundle;

if [ "$1" == "-ALL" ] || [ "$1" == "-TARGET" ]; then
    set -o pipefail
    eval "$XCODECMD | tee -a '.logs/build.log' | xcbeautify"
    COMMAND_EXIT_STATUS=${PIPESTATUS[0]}
fi

if [ "$1" == "-TESTING_ONLY_TESTS" ]; then
    # get last line of output
    #DEBUG_TESTS=$(.vscode/update_enviroment.sh "-destinationTests" "$@")
    #echo "DEBUG_TESTS: $DEBUG_TESTS"
    TESTS_SCRIPT=$(.vscode/update_enviroment.sh "-destinationTests" "$@" | tail -n 1)

    TESTS="$TESTS_SCRIPT"

    if [ "$TESTS" == "Not_defined" ]; then
        RED='\033[0;31m'
        NC='\033[0m' # No Color
        echo -e "${RED}Tests are not defined for the given file${NC}"
        exit 1  
    else
        echo "Builing for tests: $TESTS"

        set -o pipefail
        eval "$XCODECMD $TESTS build-for-testing | tee -a '.logs/build.log' | xcbeautify"
        COMMAND_EXIT_STATUS=${PIPESTATUS[0]}
    fi
fi

if [ "$1" == "-ALL" ] || [ "$1" == "-TESTING" ]; then
    set -o pipefail
    eval "$XCODECMD build-for-testing | tee -a '.logs/build.log' | xcbeautify"
    COMMAND_EXIT_STATUS=${PIPESTATUS[0]}
fi

# Check the exit status
if [ "${COMMAND_EXIT_STATUS}" -ne 0 ]; then
    python3 .vscode/print_errors.py
    echo "Build failed."
    exit 1
fi

python3 .vscode/print_errors.py