#!/usr/bin/env python3
# This program is for proxy of SWBBuildService, allows you to manipulate with XCode build on low level
from BuildServiceHelper import configure, run

configure("SWBBuildService")

if __name__ == "__main__":
    run()
