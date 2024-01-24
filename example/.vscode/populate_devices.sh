source '.vscode/.env'

DESTINATION="id=$DEVICE_ID"

python3 .vscode/populate_devices.py $PROJECT_FILE $PROJECT_SCHEME "$DESTINATION"