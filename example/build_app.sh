PROJECT_FILE=AdidasAppSuite.xcworkspace
SCHEME=adidas
BUNDLE_APP_NAME="com.adidas.app.stg"

PLATFORM="iOS Simulator"
OS="17.0.1"
DEVICE_NAME="iPhone 15 Pro"

DESTINATION="platform=$PLATFORM,OS=$OS,name=$DEVICE_NAME"

xcodebuild -workspace $PROJECT_FILE -scheme $SCHEME -configuration Debug -destination "$DESTINATION" -sdk iphonesimulator build

