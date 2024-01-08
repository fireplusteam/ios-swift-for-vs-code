source '.vscode/.env'

DESTINATION="id=$DEVICE_ID"

mkdir -p .logs

xcodebuild -workspace $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -destination "$DESTINATION" -sdk iphonesimulator build | tee '.logs/build.log'