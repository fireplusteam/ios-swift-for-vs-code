#!/bin/bash

source '.vscode/.env'
source '.vscode/.vs_env'

python3 "$VS_IOS_SCRIPT_PATH/populate_tests_of_current_file.py" "$PROJECT_FILE" "$SELECTED_VS_FILE_NAME"
