source '.vscode/.env'

#pgrep -fl xcrun
# clear log files
echo "0" > .vscode/log.changed
echo '' > .vscode/app.log

DESTINATION="platform=$PLATFORM,OS=$PLATFORM_OS,name=$DEVICE_NAME"

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
source '.vscode/.env'
BUILD_DIR=$(xcodebuild -workspace $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -sdk iphonesimulator -destination "$DESTINATION" -showBuildSettings | awk -F= '/CONFIGURATION_BUILD_DIR/ {print $2}' | tr -d '[:space:]')
APP_PATH="${BUILD_DIR}/$PROJECT_SCHEME.app"
echo "Path to the built app: ${APP_PATH}"

is_empty "$APP_PATH"

SIMULATOR_STRING=$(xcodebuild -workspace $PROJECT_FILE -scheme $PROJECT_SCHEME -showdestinations | grep -m 1 "$DEVICE_NAME" | grep -m 1 "$PLATFORM" | grep -m 1 "$PLATFORM_OS" | awk '{print $0}')

SIMULATOR_UDID=$(echo "$SIMULATOR_STRING" | grep -oE 'id:[^,]+' | awk -F':' '{print $2}')

echo "UUID of the device:${SIMULATOR_UDID}"

is_empty "$SIMULATOR_UDID"

# build a project
xcodebuild -workspace $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -destination "$DESTINATION" -sdk iphonesimulator build | tee '.vscode/build.log'

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

python3 .vscode/launch.py $SIMULATOR_UDID $BUNDLE_APP_NAME

# Get Pid Id of the launched iOS App
PID=$!

sleep 1

echo "App logs: .vscode/app.log"

# if you want to see device log console, but that one you can get via Console App
#Log Levels:
#default | info | debug
#xcrun simctl spawn $SIMULATOR_UDID log stream --level debug --process $PID --color always > .vscode/app.log 2>&1

wait $PID
