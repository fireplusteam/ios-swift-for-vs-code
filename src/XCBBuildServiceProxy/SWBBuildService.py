#!/usr/bin/env python3
# This program is for proxy of SWBBuildService, allows you to manipulate with XCode build on low level
import sys
import os

from BuildServiceUtils import make_unblocking

make_unblocking(sys.stdin)
make_unblocking(sys.stdout)
make_unblocking(sys.stderr)

_stdin, _stdout, _stderr = sys.stdin, sys.stdout, sys.stderr


def is_debug():
    if "SWBBUILD_SERVICE_PROXY_DEBUG" in os.environ:
        return os.environ["SWBBUILD_SERVICE_PROXY_DEBUG"] == "1"
    return False


if __name__ == "__main__":
    if is_debug():
        import debugpy

        debugpy.listen(5679)
        debugpy.wait_for_client()

    # import after debugger is attached
    from BuildServiceHelper import Context, run

    with Context("SWBBuildService", _stdin, _stdout, _stderr) as context:
        run(context)
