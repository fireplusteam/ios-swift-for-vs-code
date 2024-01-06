source '.vscode/.env'

DESTINATION="platform=$PLATFORM,OS=$PLATFORM_OS,name=$DEVICE_NAME"

xcodebuild -workspace $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -destination "$DESTINATION" -sdk iphonesimulator build | tee '.vscode/build.log'