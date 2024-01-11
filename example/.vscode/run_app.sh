source '.vscode/.env'

mkdir -p .logs

# clear log files
echo '' > .logs/app.log
echo "0" > .logs/log.changed

DESTINATION="id=$DEVICE_ID"

echo $DESTINATION

# Get the start time
start_time=$(date +%s.%N)

TYPE=$(if [[ $PROJECT_FILE == *.xcodeproj ]]; then echo "-project"; else echo "-workspace"; fi)

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
BUILD_DIR=$(xcodebuild $TYPE $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -sdk iphonesimulator -destination "$DESTINATION" -showBuildSettings | awk -F= '/CONFIGURATION_BUILD_DIR/ {print $2}' | tr -d '[:space:]')
APP_PATH="${BUILD_DIR}/$PROJECT_SCHEME.app"
echo "Path to the built app: ${APP_PATH}"

is_empty "$APP_PATH"

SIMULATOR_UDID=$DEVICE_ID

echo "UUID of the device:${SIMULATOR_UDID}"

is_empty "$SIMULATOR_UDID"

# build a project
rm -r .vscode/.bundle; set -o pipefail && xcodebuild $TYPE $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -destination "$DESTINATION" -sdk iphonesimulator -resultBundlePath .vscode/.bundle build | tee '.logs/build.log' | xcbeautify

# Check the exit status
if [ $? -eq 0 ]; then
    echo "OK"
else
    python3 .vscode/print_errors.py
    echo "Build failed."
    exit 1
fi

python3 .vscode/print_errors.py

# Check the exit status
if [ $? -eq 1 ]; then
    echo "Build failed."
    exit 1
fi

#xcrun simctl shutdown $SIMULATOR_UDID

echo "Booting $SIMULATOR_UDID"

# run the simulator
xcrun simctl boot $SIMULATOR_UDID

open /Applications/Xcode.app/Contents/Developer/Applications/Simulator.app/

# Wait until the simulator is booted
while [ "$(xcrun simctl list devices | grep $SIMULATOR_UDID | grep -c 'Booted')" -eq 0 ]; do
    sleep 1
done

sleep 2

# install on simulator
xcrun simctl install $SIMULATOR_UDID $APP_PATH

# Get the end time
end_time=$(date +%s.%N)

# Calculate the execution time
execution_time=$(echo "$end_time - $start_time" | bc)

echo "Execution time $execution_time"

if [ $1 == "LLDB_DEBUG" ]; then
    # Check if the execution time is less than 5 seconds and sleep to wait lldb to init
    if (( $(echo "$execution_time < 10" | bc -l) )); then
        echo "Execution time was less than 10 seconds. Sleeping..."
        sleep 5
    fi
fi

# Get PID of run process
python3 .vscode/async_launcher.py .vscode/launch.py $SIMULATOR_UDID $BUNDLE_APP_NAME

# Get Pid Id of the launched iOS App
PID=$!

sleep 1

python3 .vscode/update_debug_launch_settings.py $SIMULATOR_UDID $BUNDLE_APP_NAME 

# if you want to see device log console, but that one you can get via Console App
#Log Levels:
#default | info | debug
#xcrun simctl spawn $SIMULATOR_UDID log stream --level debug --process $PID --color always > .logs/app.log 2>&1

#wait $PID
