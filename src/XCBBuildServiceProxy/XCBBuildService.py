#!/usr/bin/env python3
# This program is for proxy of XCBBuildService, allows you to manipulate with XCode build on low level
from BuildServiceHelper import configure, run

configure("XCBBuildService")

if __name__ == "__main__":
    run()
