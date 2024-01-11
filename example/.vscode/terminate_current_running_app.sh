source '.vscode/.env'

# Stop previously running app
xcrun simctl terminate $DEVICE_ID $BUNDLE_APP_NAME

if [ $? -eq 1 ]; then
    echo "Termination failed."
    exit 0
fi