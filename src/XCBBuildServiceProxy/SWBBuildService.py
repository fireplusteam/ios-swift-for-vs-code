#!/usr/bin/env python3
# This program is for proxy of SWBBuildService, allows you to manipulate with XCode build on low level

# import debugpy

# debugpy.listen(5679)
# print("Waiting for debugger attach...")
# debugpy.wait_for_client()


# import after debugger is attached
from BuildServiceHelper import configure, run

configure("SWBBuildService")

if __name__ == "__main__":
    run()
