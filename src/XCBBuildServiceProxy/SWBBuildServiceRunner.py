#!/usr/bin/env python3
import sys
import subprocess
import os
import time
from BuildServiceHelper import check_for_exit
from BuildServiceHelper import make_unblocking

# to build standalone executable use pyinstaller:
# pyinstaller --onefile src/XCBBuildServiceProxy/SWBBuildServiceRunner.py --name SWBBuildService

if __name__ == "__main__":
    if "SWBBUILD_SERVICE_PROXY_PATH" not in os.environ:
        # default path to the SWBBuildService proxy script
        python_script = "/Users/Ievgenii_Mykhalevskyi/repos/fireplusteam/ios_vs_code/src/XCBBuildServiceProxy/SWBBuildService.py"
    else:
        python_script = os.environ["SWBBUILD_SERVICE_PROXY_PATH"]
    # debug command, use `which python3` to find the path to python3 interpreter
    command = ["/opt/anaconda3/bin/python3", "-u", python_script] + sys.argv[1:]
    sys.stderr.writelines(f"SWBBUILD_SERVICE_PROXY_PATH: {python_script}\n")
    sys.stderr.writelines(f"Command: {' '.join(command)}\n")

    # create subprocess to run the actual SWBBuildService proxy script with redirected stdin/stdout/stderr

    make_unblocking(sys.stdin)
    make_unblocking(sys.stdout)
    make_unblocking(sys.stderr)

    proc = subprocess.Popen(
        command,
        cwd=os.getcwd(),
        stdin=sys.stdin,
        stdout=sys.stdout,
        stderr=sys.stdout,
        env=os.environ,
    )
    while True:
        if proc.poll() is not None:
            break
        time.sleep(0.5)
        # check if parent process asked to exit

        if sys.stdin.closed:
            break
        sys.stderr.writelines(
            f"Check Exit: {check_for_exit()}, pid: {proc.pid}, poll: {proc.poll()}\n"
        )
        if check_for_exit():
            break
    sys.stderr.writelines("Terminating SWBBuildService proxy subprocess...\n")
