
source '.vscode/.env'
DESTINATION="platform=$PLATFORM,OS=$PLATFORM_OS,name=$DEVICE_NAME"
xcodebuild test -workspace $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -sdk iphonesimulator -destination "$DESTINATION" 
