PROJECT_FILE="$1"
SCHEME="$2"
BUNDLE_APP_NAME="$3"

PLATFORM="$4"
OS="$5"
DEVICE_NAME="$6"

DESTINATION="platform=$PLATFORM,OS=$OS,name=$DEVICE_NAME"

echo $DESTINATION

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
BUILD_DIR=$(xcodebuild -workspace $PROJECT_FILE -scheme $SCHEME -configuration Debug -sdk iphonesimulator -destination "$DESTINATION" -showBuildSettings | awk -F= '/CONFIGURATION_BUILD_DIR/ {print $2}' | tr -d '[:space:]')
APP_PATH="${BUILD_DIR}/$SCHEME.app"
echo "Path to the built app: ${APP_PATH}"

is_empty "$APP_PATH"

SIMULATOR_STRING=$(xcodebuild -workspace $PROJECT_FILE -scheme $SCHEME -showdestinations | grep -m 1 "$DEVICE_NAME" | grep -m 1 "$PLATFORM" | grep -m 1 "$OS" | awk '{print $0}')

SIMULATOR_UDID=$(echo "$SIMULATOR_STRING" | grep -oE 'id:[^,]+' | awk -F':' '{print $2}')

echo "UUID of the device:${SIMULATOR_UDID}"

is_empty "$SIMULATOR_UDID"

# build a project
xcodebuild -workspace $PROJECT_FILE -scheme $SCHEME -configuration Debug -destination "$DESTINATION" -sdk iphonesimulator build

# Check the exit status
if [ $? -eq 0 ]; then
    echo "Build succeeded."
else
    echo "Build failed."
    exit 1
fi

# run the simulator
open -a Simulator --args -CurrentDeviceUDID $SIMULATOR_UDID

# Wait until the simulator is booted
while [ "$(xcrun simctl list devices | grep $SIMULATOR_UDID | grep -c 'Booted')" -eq 0 ]; do
    sleep 1
done

# install on simulator

xcrun simctl install $SIMULATOR_UDID $APP_PATH

# Get PID of run process

BUNDLE_PID=$(xcrun simctl launch $SIMULATOR_UDID $BUNDLE_APP_NAME)

xcrun simctl spawn booted ps -e | grep BUNDLE_APP_NAME

PID=$(echo "$BUNDLE_PID" | grep -oE '[0-9]+' | awk '{print $1}')

# Print the PID
echo "PID of $BUNDLE_APP_NAME:$PID"

# Generate the debugger launch

cat << EOF > .vscode/launch.json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "lldb",
            "request": "attach",
            "name": "Attach",
            "pid": $PID,
            "stopOnEntry": false
        },
        {
            "name": "Show App Log",
            "type": "node",
            "request": "launch",
            "program": ".vscode/show-app-log.js",
            "stopOnEntry": false,
            "args": [".vscode/app_log.txt"],
            "console": "internalConsole",
            "internalConsoleOptions": "neverOpen"
        }
    ]
}
EOF

#xcrun simctl spawn $SIMULATOR_UDID log stream --predicate "processID == $PID" 2>&1 | tee app_log.txt

echo "App logs: .vscode/app_log.txt"

xcrun simctl spawn $SIMULATOR_UDID log stream --predicate "processID == $PID" > '.vscode/app_log.txt' 2>&1 &
