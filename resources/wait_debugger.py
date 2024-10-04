#!/usr/bin/env python3
import sys
import helper

session_id = sys.argv[1]
helper.wait_debugger_to_launch(session_id)