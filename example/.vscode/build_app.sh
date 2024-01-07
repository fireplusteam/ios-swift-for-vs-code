source '.vscode/.env'

DESTINATION="id=$DEVICE_ID"

xcodebuild -workspace $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -destination "$DESTINATION" -sdk iphonesimulator build | tee '.vscode/build.log'