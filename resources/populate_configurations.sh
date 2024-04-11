#!/bin/bash

source '.vscode/.env'

python3 "$VS_IOS_SCRIPT_PATH/populate_configurations.py" "$1" "$PROJECT_CONFIGURATION"
