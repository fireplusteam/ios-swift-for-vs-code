#!/usr/bin/env python3
import sys
import subprocess
import os
import time
import threading
import time
from BuildServiceHelper import check_for_exit
from BuildServiceHelper import make_unblocking

# to build standalone executable use pyinstaller:
# pyinstaller --onefile src/XCBBuildServiceProxy/SWBBuildServiceRunner.py --name SWBBuildService


def redirect_in(src, dst):
    while True:
        if hasattr(src, "buffer"):
            data = src.buffer.read(1)
        else:
            data = src.read(1)
        if data:
            dst.write(data)
            if hasattr(dst, "flush"):
                dst.flush()
        else:
            time.sleep(0.01)


def redirect(src, dst):
    while True:
        data = src.read(1)
        if data:
            dst.buffer.write(data)
            if hasattr(dst, "flush"):
                dst.flush()
        else:
            time.sleep(0.01)


if __name__ == "__main__":
    if "SWBBUILD_SERVICE_PROXY_PATH" not in os.environ:
        # default path to the SWBBuildService proxy script
        python_script = "/Users/Ievgenii_Mykhalevskyi/repos/fireplusteam/ios_vs_code/src/XCBBuildServiceProxy/SWBBuildService.py"
    else:
        python_script = os.environ["SWBBUILD_SERVICE_PROXY_PATH"]

        # debug command, use `which python3` to find the path to python3 interpreter
    stdout_file_path = os.path.join(
        os.path.dirname(python_script), "logs/SWBBuildService_proxy_out_fifo.log"
    )

    command = [
        "/opt/anaconda3/bin/python3",
        "-u",
        python_script,
        "--stdout-log-path",
        stdout_file_path,
    ] + sys.argv[1:]
    sys.stderr.writelines(f"SWBBUILD_SERVICE_PROXY_PATH: {python_script}\n")
    sys.stderr.writelines(f"Command: {' '.join(command)}\n")
    sys.stderr.writelines(f"Stdout file path: {stdout_file_path}\n")

    # create subprocess to run the actual SWBBuildService proxy script with redirected stdin/stdout/stderr

    make_unblocking(sys.stdin)
    make_unblocking(sys.stdout)
    make_unblocking(sys.stderr)

    if not os.path.exists(os.path.dirname(stdout_file_path)):
        os.makedirs(os.path.dirname(stdout_file_path), exist_ok=True)
    # create file empty file
    if not os.path.exists(stdout_file_path):
        # open(stdout_file_path, "wb").close()
        # fifo for binary output
        os.mkfifo(stdout_file_path)
    proc = subprocess.Popen(
        command,
        cwd=os.getcwd(),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=os.environ,
    )

    try:
        with open(stdout_file_path, "rb") as std_out_file:
            threading.Thread(
                target=redirect, args=(std_out_file, sys.stdout), daemon=True
            ).start()
            threading.Thread(
                target=redirect, args=(proc.stderr, sys.stderr), daemon=True
            ).start()
            threading.Thread(
                target=redirect_in, args=(sys.stdin, proc.stdin), daemon=True
            ).start()

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
            proc.terminate()
    finally:
        os.remove(stdout_file_path)
