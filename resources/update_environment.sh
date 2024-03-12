#!/bin/bash

source '.vscode/.env'

echo "INPUT: $*"

python3 "$VS_IOS_SCRIPT_PATH/update_environment.py" "$PROJECT_FILE" "$@"
