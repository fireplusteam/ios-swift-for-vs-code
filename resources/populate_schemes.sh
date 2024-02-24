#!/bin/bash

source '.vscode/.env'

python3 "$VS_IOS_SCRIPT_PATH/populate_schemes.py" "$PROJECT_FILE" "$PROJECT_SCHEME"
