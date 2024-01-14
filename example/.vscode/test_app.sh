source '.vscode/.env'

DESTINATION="id=$DEVICE_ID"

mkdir -p .logs

rm .logs/build.log

TYPE=$(if [[ $PROJECT_FILE == *.xcodeproj ]]; then echo "-project"; else echo "-workspace"; fi)

export NSUnbufferedIO=YES
export XCT_PARALLEL_DEVICE_DESTINATIONS=1

rm -r .vscode/.bundle.xcresult
rm -r .vscode/.bundle

VALID_TESTS=1

if [ "$1" == "ALL" ]; then
    xcodebuild test-without-building $TYPE $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -sdk iphonesimulator -destination "$DESTINATION" -resultBundlePath .vscode/.bundle | tee '.logs/build.log' | xcbeautify
else
    echo "Input: $@"

    # get last line of output
    TESTS_SCRIPT=$(.vscode/update_enviroment.sh "-destinationTests" "$@" | tail -n 1)
    TESTS_LINE=$(echo "$TESTS_SCRIPT")

    TESTS="$TESTS_LINE"

    if [ $TESTS == "Not_defined" ]; then
        echo "Tests are not defined for the given file"
        VALID_TESTS=0
    else
        echo "Running tests: $TESTS" 

        xcodebuild test-without-building $TYPE $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -sdk iphonesimulator -destination "$DESTINATION" -resultBundlePath .vscode/.bundle -only-testing  "$TESTS" | tee '.logs/build.log' | xcbeautifyf
    fi
fi

if [ $VALID_TESTS -eq 1 ]; then
    # Open Results
    REPORT_PATH='/.vscode/.bundle.xcresult'
    LOCAL_PATH=$(pwd)

    URL=$LOCAL_PATH$REPORT_PATH
    URL=${URL// /%20}

    echo "Test  Report: $URL"
    # if you want to open a report in xcode, uncomment below line
    #open -a XCode  "file://$URL"

    # print errors
    # Check the exit status
    python3 .vscode/print_errors.py

    echo 'Your testing results are in: .logs/build.log'
fi