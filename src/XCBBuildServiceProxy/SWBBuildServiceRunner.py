#!/usr/bin/env python3
import sys
import os
import asyncio
from BuildServiceUtils import push_data_to_stdout
from BuildServiceUtils import check_for_exit
from BuildServiceUtils import make_unblocking
from MessageReader import MessageReader, MsgStatus

# to build standalone executable use pyinstaller:
# pyinstaller --onefile src/XCBBuildServiceProxy/SWBBuildServiceRunner.py --name SWBBuildService --distpath ~/Library/Application\ Support/SWBBuildServiceProxy/


if __name__ == "__main__":
    # if "SWBBUILD_SERVICE_PROXY_PATH" not in os.environ:
    # default path to the SWBBuildService proxy script
    python_script = "/Users/Ievgenii_Mykhalevskyi/repos/fireplusteam/ios_vs_code/src/XCBBuildServiceProxy/SWBBuildService.py"
    # else:
    #     python_script = os.environ["SWBBUILD_SERVICE_PROXY_PATH"]

    # setup virtual environment path
    venv_path = "/Users/Ievgenii_Mykhalevskyi/repos/fireplusteam/ios_vs_code/venv"
    env = os.environ.copy()
    env["VENV_PATH"] = venv_path
    # enable debug mode in the subprocess
    env["SWBBUILD_SERVICE_PROXY_DEBUG"] = "1"

    command = [
        f"{venv_path}/bin/python3",
        "-u",
        python_script,
    ] + sys.argv[1:]
    sys.stderr.writelines(f"SWBBUILD_SERVICE_PROXY_PATH: {python_script}\n")
    sys.stderr.writelines(f"Command: {' '.join(command)}\n")

    # create subprocess to run the actual SWBBuildService proxy script with redirected stdin/stdout/stderr

    make_unblocking(sys.stdin)
    make_unblocking(sys.stdout)
    make_unblocking(sys.stderr)

    async def run_loop():
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

        # read stdout and stderr and stdin in different run loops to avoid blocking
        async def read_stdout():
            sys.stderr.writelines("Started reading stdout...\n")
            msg = MessageReader()
            while True:
                data = await process.stdout.read(msg.expecting_bytes_from_io())
                if data:
                    # sys.stderr.writelines(f"Read {len(data)} bytes from stdout\n")
                    for b in data:
                        msg.feed(b.to_bytes(1, "big"))
                        if msg.status == MsgStatus.MsgEnd:
                            buffer = msg.buffer.copy()
                            msg.reset()
                            await push_data_to_stdout(buffer, sys.stdout)
                else:
                    await asyncio.sleep(0.1)

        async def read_stderr():
            sys.stderr.writelines("Started reading stderr...\n")
            while True:
                data = await process.stderr.read(1)
                if data:
                    await push_data_to_stdout(data, sys.stderr)
                else:
                    await asyncio.sleep(0.1)

        async def write_stdin():
            sys.stderr.writelines("Started writing stdin...\n")
            while True:
                data = sys.stdin.buffer.read(1)
                if data:
                    process.stdin.write(data)
                    await process.stdin.drain()
                else:
                    await asyncio.sleep(0.1)

        asyncio.create_task(read_stdout())
        asyncio.create_task(read_stderr())
        asyncio.create_task(write_stdin())
        try:
            while True:
                if process.returncode is not None:
                    break
                await asyncio.sleep(0.5)

                # check if parent process asked to exit
                # sys.stderr.writelines(
                #     f"Check Exit: {await check_for_exit()}, pid: {process.pid}, returncode: {process.returncode}\n"
                # )
                if "-proxy-server" in sys.argv:
                    continue  # in server mode do not check for exit
                if await check_for_exit():
                    break
            sys.stderr.writelines("Terminating SWBBuildService proxy subprocess...\n")
            process.terminate()
        finally:
            pass

    asyncio.run(run_loop())
