PROJECT_FILE="$1"
SCHEME="$2"
BUNDLE_APP_NAME="$3"

PLATFORM="iOS Simulator"
OS="17.0.1"
DEVICE_NAME="iPhone 15 Pro"

DESTINATION="platform=$PLATFORM,OS=$OS,name=$DEVICE_NAME"

xcodebuild -workspace $PROJECT_FILE -scheme $SCHEME -configuration Debug -destination "$DESTINATION" -sdk iphonesimulator build

