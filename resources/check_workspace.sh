#!/bin/bash
source '.vscode/.env'

python3 "$VS_IOS_SCRIPT_PATH/check_workspace.py" "$PROJECT_FILE"