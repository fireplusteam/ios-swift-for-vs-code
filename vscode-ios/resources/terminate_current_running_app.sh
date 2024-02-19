#!/bin/bash
source '.vscode/.env'

python3 .vscode/terminate_current_running_app.py

# Stop previously running app
xcrun simctl terminate "$DEVICE_ID" "$BUNDLE_APP_NAME"

if [ $? -eq 1 ]; then
    echo "Termination failed."
    exit 0
fi