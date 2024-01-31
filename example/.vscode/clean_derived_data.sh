#!/bin/bash

PATH_SCRIPT=$(python3 <<EOF
import sys
sys.path.insert(0, '.vscode')
import helper

path = helper.get_derived_data_path()
print(path)

EOF
)

PATH_SCRIPT=$(echo "$PATH_SCRIPT" | tail -n 1)

rm -rf "$PATH_SCRIPT"