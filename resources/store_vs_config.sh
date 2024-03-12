#!/bin/bash

env="SELECTED_VS_FILE_NAME=\"$1\""

# Store the string in a file
echo "$env" >.vscode/.vs_env
