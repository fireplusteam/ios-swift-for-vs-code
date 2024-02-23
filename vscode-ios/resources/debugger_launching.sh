#!/bin/bash
python3 <<EOF
import sys
sys.path.insert(0, "$VS_IOS_SCRIPT_PATH")
import helper
helper.update_debugger_launch_config("$1", "status", "launching")
EOF