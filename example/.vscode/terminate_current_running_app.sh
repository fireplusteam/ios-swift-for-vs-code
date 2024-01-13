source '.vscode/.env'

# Stop previously running app
#xcrun simctl terminate booted $BUNDLE_APP_NAME

python3 .vscode/terminate_current_running_app.py

#if [ $? -eq 1 ]; then
#    echo "Termination failed."
#    exit 0
#fi