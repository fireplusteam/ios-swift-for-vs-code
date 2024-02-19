#!/bin/bash

source '.vscode/.env'

DESTINATION="id=$DEVICE_ID"

if [ "$1" == "-multi" ]; then
    DESTINATION=$MULTIPLE_DEVICE_ID
fi

python3 "$VS_IOS_SCRIPT_PATH/populate_devices.py" "$PROJECT_FILE" "$PROJECT_SCHEME" "$DESTINATION" "$1"