#!/usr/bin/env python3
import sys
import subprocess
import os

# to build standalone executable use pyinstaller:
# pyinstaller --onefile src/XCBBuildServiceProxy/SWBBuildServiceRunner.py --name SWBBuildService

if __name__ == "__main__":
    python_script = os.environ["SWBBUILD_SERVICE_PROXY_PATH"]
    # debug command, use `which python3` to find the path to python3 interpreter
    command = ["/opt/anaconda3/bin/python3", "-u", python_script] + sys.argv[1:]
    sys.stderr.writelines(f"SWBBUILD_SERVICE_PROXY_PATH: {python_script}\n")
    sys.stderr.writelines(f"Command: {' '.join(command)}\n")

    # create subprocess to run the actual SWBBuildService proxy script with redirected stdin/stdout/stderr

    proc = subprocess.Popen(
        command,
        cwd=os.getcwd(),
        stdin=sys.stdin,
        stdout=sys.stdout,
        stderr=sys.stdout,
    )
    proc.wait()
    sys.exit(proc.returncode)
