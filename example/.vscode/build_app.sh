PROJECT_FILE="$1"
SCHEME="$2"
BUNDLE_APP_NAME="$3"

PLATFORM="$4"
OS="$5"
DEVICE_NAME="$6"

DESTINATION="platform=$PLATFORM,OS=$OS,name=$DEVICE_NAME"

xcodebuild -workspace $PROJECT_FILE -scheme $SCHEME -configuration Debug -destination "$DESTINATION" -sdk iphonesimulator build | tee '.vscode/build.log'