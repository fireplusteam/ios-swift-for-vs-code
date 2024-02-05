#!/bin/bash
source '.vscode/.env'

SELECTED_FILE=$1

SCHEME_SCRIPT=$(python3 <<EOF
import sys
sys.path.insert(0, '.vscode')
import helper
import xcutil

scheme = xcutil.get_scheme_by_file_name("$PROJECT_FILE", "$SELECTED_FILE")
print(scheme)

EOF
)

echo "MODULE NAME OF $SELECTED_FILE IS: $SCHEME_SCRIPT" 