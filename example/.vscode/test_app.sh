#!/bin/bash

source '.vscode/.env'

if [ "$2" == "CANCEL" ]; then
    exit 0
fi

DESTINATION="id=$DEVICE_ID"

mkdir -p .logs

rm .logs/build.log

TYPE=$(if [[ $PROJECT_FILE == *.xcodeproj ]]; then echo "-project"; else echo "-workspace"; fi)

export NSUnbufferedIO=YES
export XCT_PARALLEL_DEVICE_DESTINATIONS=1

rm -r .vscode/.bundle.xcresult
rm -r .vscode/.bundle

# clear log files
rm .logs/app.log
echo '' > .logs/app.log
echo "0" > .logs/log.changed

VALID_TESTS=1

# uncomment below if you want to reset all cache on simulators

#echo "Shutting down the simulator app"
#osascript -e 'quit app "Simulator"'
#
#echo "Making sure ALL simulators are shutdown"
#xcrun simctl list | grep Booted | grep -e "[0-9A-F\-]\{36\}" -o | xargs xcrun simctl shutdown
#
#echo "Erasing apps from all simulators and resetting back to clean state"
#xcrun simctl erase all
#
#echo "Killing com.apple.CoreSimulator.CoreSimulatorService"
#killall -9 com.apple.CoreSimulator.CoreSimulatorService


if [ "$3" == "DEBUG_LLDB" ]; then

python3 <<EOF
import sys
sys.path.insert(0, '.vscode')
import helper
helper.wait_debugger_to_launch()
EOF

else

echo "TERMINATING DEBUG SESSION"
# terminate debug session otherwise
sh .vscode/terminate_current_running_app.sh

fi


if [ "$1" == "ALL" ]; then
    xcodebuild test-without-building "$TYPE" "$PROJECT_FILE" -scheme "$PROJECT_SCHEME" -configuration Debug -sdk iphonesimulator -destination "$DESTINATION" -resultBundlePath .vscode/.bundle | tee '.logs/tests.log' | tee '.logs/app.log' | xcbeautify
else
    echo "Input: '$*'"

    # get last line of output
    TESTS_SCRIPT=$(.vscode/update_enviroment.sh "-destinationTests" "$@" | tail -n 1)

    TESTS="$TESTS_SCRIPT"

    if [ "$TESTS" == "Not_defined" ]; then
        echo "Tests are not defined for the given file"
        VALID_TESTS=0
    else
        echo "Running tests: $TESTS" 
        
        xcodebuild test-without-building "$TYPE" "$PROJECT_FILE" -scheme "$PROJECT_SCHEME" -configuration Debug -sdk iphonesimulator -destination "$DESTINATION" -resultBundlePath .vscode/.bundle $TESTS | tee '.logs/tests.log' | tee '.logs/app.log' | xcbeautify
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
    python3 .vscode/print_errors.py '.logs/tests.log'

    echo 'Your testing results are in: .logs/tests.log'
fi

sleep 3
sh .vscode/terminate_current_running_app.sh