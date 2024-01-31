#!/bin/bash

source '.vscode/.env'

python3 .vscode/populate_schemes.py "$PROJECT_FILE" "$PROJECT_SCHEME"
