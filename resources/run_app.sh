#!/bin/bash

source '.vscode/.env'

mkdir -p .logs

DESTINATION="id=$DEVICE_ID"

echo "$DESTINATION"

if [ "$3" == "-DEVICES" ]; then
    python3 "$VS_IOS_SCRIPT_PATH/update_environment.py" "$PROJECT_FILE" -multipleDestinationDevices "$4"
    DESTINATION="$4"
elif [ "$3" == "-MAC_OS" ]; then
    echo "LAUNCHING..."
    python3 "$VS_IOS_SCRIPT_PATH/async_launcher.py" "$VS_IOS_SCRIPT_PATH/launch.py" "MAC_OS" "$BUNDLE_APP_NAME" "$2" "$1"
    echo "WAITING DEBUGGER..."
    exit 0
fi

# Function to check if a variable is empty and exit with 1
is_empty() {
    local variable=$1

    if [ -z "$variable" ]; then
        echo "$variable variable is empty."
        exit 1
    else
        echo "Good to proceed further"
    fi
}

# GET BUILD PATH
APP_PATH=$(
    python3 <<EOF
import sys
sys.path.insert(0, "$VS_IOS_SCRIPT_PATH")
import helper
print(helper.get_target_executable())
EOF
)

echo "Path to the built app: ${APP_PATH}"

check_exit_status() {
    local exit_status="$1"
    if [ "${exit_status}" -ne 0 ]; then
        exit 1
    fi
}

is_empty "$APP_PATH"
IFS=' |'
for SINGLE_DESTINATION in $DESTINATION; do
    SIMULATOR_UDID=${SINGLE_DESTINATION#id=} # Removes prefix id=

    echo "UUID of the device:${SIMULATOR_UDID}"

    is_empty "$SIMULATOR_UDID"

    #xcrun simctl shutdown $SIMULATOR_UDID

    echo "Booting $SIMULATOR_UDID"

    # run the simulator
    xcrun simctl boot "$SIMULATOR_UDID"

    open /Applications/Xcode.app/Contents/Developer/Applications/Simulator.app/
    check_exit_status $?

    # Wait until the simulator is booted
    while [ "$(xcrun simctl list devices | grep "$SIMULATOR_UDID" | grep -c 'Booted')" -eq 0 ]; do
        sleep 1
    done

    sleep 2
    # install on simulator
    xcrun simctl install "$SIMULATOR_UDID" "$APP_PATH"
    check_exit_status $?
    # Get PID of run process
    echo "LAUNCHING..."
    python3 "$VS_IOS_SCRIPT_PATH/async_launcher.py" "$VS_IOS_SCRIPT_PATH/launch.py" "$SIMULATOR_UDID" "$BUNDLE_APP_NAME" "$2" "$1"
    echo "WAITING DEBUGGER..."
done

# if you want to see device log console, but that one you can get via Console App
#Log Levels:
#default | info | debug
# xcrun simctl spawn $SIMULATOR_UDID log stream --level debug --process $PID --color always >.logs/app_$DEVICE_ID.log 2>&1
