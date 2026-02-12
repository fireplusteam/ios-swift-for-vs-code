#!/usr/bin/env python3
# This program is for proxy of SWBBuildService, allows you to manipulate with XCode build on low level
# to build standalone executable use pyinstaller:
# pyinstaller --onefile src/XCBBuildServiceProxy/SWBBuildService.py --name SWBBuildService --distpath ~/Library/Application\ Support/SWBBuildServiceProxy/

import sys
import os

from BuildServiceUtils import (
    get_server_pid_by_session_id,
    client_put_message_to_server,
    get_build_id,
    server_get_message_from_client,
    config_file,
)
import lib.filelock as filelock
from BuildServiceHelper import Context, run_client, run_server, run_xcode_client


_stdin, _stdout, _stderr = sys.stdin, sys.stdout, sys.stderr


def is_debug():
    if "SWBBUILD_SERVICE_PROXY_DEBUG" in os.environ:
        return os.environ["SWBBUILD_SERVICE_PROXY_DEBUG"] == "1"
    return False


def main():
    with Context("SWBBuildService", _stdin, _stdout, _stderr) as context:
        if context.is_client:
            if is_debug():
                import debugpy

                debugpy.listen(5679)
                debugpy.wait_for_client()

            if "SWBBUILD_SERVICE_PROXY_SESSION_ID" not in os.environ:
                # xcode version as proxy session id is not set, just run client as is
                run_xcode_client(context)
                return

            import subprocess
            import tempfile

            # create pipes communication with server, delete temp files after communication done
            with tempfile.NamedTemporaryFile(
                "wb"
            ) as stdin_temp, tempfile.NamedTemporaryFile("rb") as stdout_temp:

                config_file_path = config_file()
                lock_path = config_file_path + ".lock"
                with filelock.FileLock(lock_path, timeout=5):
                    try:
                        message = server_get_message_from_client(False)
                    except:
                        message = None
                    build_id = get_build_id()
                    if message:
                        if int(message["build_id"]) >= build_id:
                            # this client is outdated
                            return

                    message = {
                        "command": "build",
                        "stdin_file": stdin_temp.name,
                        "stdout_file": stdout_temp.name,
                        "build_id": build_id,
                    }
                    client_put_message_to_server(message, False)

                context.stdin_file = stdin_temp
                context.stdout_file = stdout_temp  # read out of server's stdout

                context.server_pid = get_server_pid_by_session_id(context.session_id)
                if not context.server_pid:
                    server_command = sys.argv + ["-proxy-server", context.session_id]
                    if is_debug():
                        server_command = context.command + [
                            "-proxy-server",
                            context.session_id,
                        ]
                        server_command[0] = server_command[0].replace("-origin", "")
                    server = subprocess.Popen(
                        server_command,
                        close_fds=True,
                        start_new_session=True,
                        cwd=os.getcwd(),
                        env=os.environ,
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    context.server_pid = server.pid
                run_client(context)
        else:  # server
            if is_debug():
                import debugpy

                debugpy.listen(5680)
                debugpy.wait_for_client()
            run_server(context)


if __name__ == "__main__":
    # import after debugger is attached
    main()
