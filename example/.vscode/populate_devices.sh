source '.vscode/.env'

DESTINATION="id=$DEVICE_ID"

if [ "$1" == "-multi" ]; then
DESTINATION=$MULTIPLE_DEVICE_ID
fi

python3 .vscode/populate_devices.py $PROJECT_FILE $PROJECT_SCHEME "$DESTINATION" $1