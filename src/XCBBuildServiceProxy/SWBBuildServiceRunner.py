#!/usr/bin/env python3
import sys
import os
import asyncio
import aiofiles
import tempfile
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

    temp_file = tempfile.NamedTemporaryFile()

    command = [
        "/opt/anaconda3/bin/python3",
        "-u",
        python_script,
        "-log-file-name-proxy",
        temp_file.name,
    ] + sys.argv[1:]
    sys.stderr.writelines(f"SWBBUILD_SERVICE_PROXY_PATH: {python_script}\n")
    sys.stderr.writelines(f"Command: {' '.join(command)}\n")
    sys.stderr.writelines(f"Stdout file path: {temp_file.name}\n")

    # create subprocess to run the actual SWBBuildService proxy script with redirected stdin/stdout/stderr

    make_unblocking(sys.stdin)
    make_unblocking(sys.stdout)
    make_unblocking(sys.stderr)

    async def run_loop(stdout_file_path):
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # read stdout and stderr and stdin in different run loops to avoid blocking
        async def read_stdout():
            sys.stderr.writelines("Started reading stdout...\n")
            async with aiofiles.open(
                stdout_file_path, mode="rb", buffering=0
            ) as stdout_file:
                while True:
                    data = await stdout_file.read(1024)
                    if data:
                        # sys.stderr.buffer.write(data)
                        # sys.stderr.buffer.flush()

                        sys.stdout.buffer.write(data)
                        sys.stdout.buffer.flush()
                    else:
                        await asyncio.sleep(0.1)

        async def read_stderr():
            sys.stderr.writelines("Started reading stderr...\n")
            while True:
                data = await process.stderr.read(1)
                if data:
                    pass
                    # sys.stderr.buffer.write(data)
                    # sys.stderr.buffer.flush()
                else:
                    await asyncio.sleep(0.1)

        async def write_stdin():
            sys.stderr.writelines("Started writing stdin...\n")
            while True:
                data = sys.stdin.buffer.read(1)
                if data:
                    # sys.stderr.buffer.write(data)
                    # sys.stderr.buffer.flush()
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
                if sys.stdin.closed:
                    break
                # sys.stderr.writelines(
                #     f"Check Exit: {await check_for_exit()}, pid: {process.pid}, returncode: {process.returncode}\n"
                # )
                if await check_for_exit():
                    break
            sys.stderr.writelines("Terminating SWBBuildService proxy subprocess...\n")
            process.terminate()
        finally:
            pass

    asyncio.run(run_loop(temp_file.name))
