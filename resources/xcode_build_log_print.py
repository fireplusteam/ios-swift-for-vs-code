#!/usr/bin/env python3
import sys
from xcode_build_helper import parse_xclogs

# print xcode build logs to console

build_path = sys.argv[1]
for l in parse_xclogs(build_path):
    print(l)
