#!/bin/bash
source '.vscode/.env'

python3 .vscode/check_workspace.py "$PROJECT_FILE"