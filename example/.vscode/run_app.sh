source '.vscode/.env'

mkdir -p .logs

# clear log files
echo '' > .logs/app.log
echo "0" > .logs/log.changed

DESTINATION="id=$DEVICE_ID"

echo $DESTINATION

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
xcodebuild $TYPE $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -destination "$DESTINATION" -sdk iphonesimulator build | tee '.logs/build.log'

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

# Get PID of run process

python3 .vscode/launch.py $SIMULATOR_UDID $BUNDLE_APP_NAME

# Get Pid Id of the launched iOS App
PID=$!

sleep 1

# if you want to see device log console, but that one you can get via Console App
#Log Levels:
#default | info | debug
#xcrun simctl spawn $SIMULATOR_UDID log stream --level debug --process $PID --color always > .logs/app.log 2>&1

wait $PID
