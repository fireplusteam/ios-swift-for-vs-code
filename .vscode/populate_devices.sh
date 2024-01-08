source '.vscode/.env'

DESTINATION="platform=$PLATFORM,id=$DEVICE_ID,OS=$PLATFORM_OS,name=$DEVICE_NAME"

python3 .vscode/populate_devices.py $PROJECT_FILE $PROJECT_SCHEME "$DESTINATION"