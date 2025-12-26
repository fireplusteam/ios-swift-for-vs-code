#!/usr/bin/env python3
import sys
import helper

helper.update_debugger_launch_config(sys.argv[1], "status", sys.argv[2])
