#!/usr/bin/env python3
# This program is for proxy of SWBBuildService, allows you to manipulate with XCode build on low level
import sys
import os
import asyncio
import subprocess
from MessageReader import MessageReader, MsgStatus


class Context:

    def __init__(self, serviceName: str):
        # non zero - write logs from server to input files
        self.debug_mode = 0

        self.serviceName = serviceName
        self.should_exit = False

        cache_path = os.path.join(
            os.path.expanduser(f"~/Library/Caches/{serviceName}Proxy"),
        )

        os.makedirs(cache_path, exist_ok=True)
        # log file for debug info
        self.log_file = open(f"{cache_path}/xcbuild.log", "w+")

        xcode_dev_path = (
            subprocess.run(
                "xcode-select -p", shell=True, capture_output=True, check=True
            )
            .stdout.decode("utf-8")
            .strip("\n")
        )
        xcode_dev_path_components = xcode_dev_path.split(os.path.sep)
        if xcode_dev_path_components[-1] == "Developer":
            build_service_path = os.path.sep.join(xcode_dev_path_components[0:-1])
        else:
            build_service_path = os.path.sep.join(xcode_dev_path_components)
        build_service_path = os.path.join(
            build_service_path,
            (
                "SharedFrameworks/SwiftBuild.framework/Versions/A/PlugIns/SWBBuildService.bundle/Contents/MacOS"
                if serviceName == "SWBBuildService"
                else "SharedFrameworks/XCBuild.framework/Versions/A/PlugIns/XCBBuildService.bundle/Contents/MacOS"
            ),
        )

        def filter_args():
            i = 1
            ret = []
            while i < len(sys.argv):
                if sys.argv[i] == "-log-file-name-proxy":
                    self.stdout_file_name = sys.argv[i + 1]
                    i += 2
                else:
                    ret.append(sys.argv[i])
                    i += 1
            return ret

        self.stdout_file = None
        self.command = [f"{build_service_path}/{serviceName}-origin"] + filter_args()

    def __enter__(self):
        self.stdout_file = open(self.stdout_file_name, "wb")
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.stdout_file.close()

    def log(self, *args, **kwargs):
        if self.debug_mode != 0:
            self.log_file.write(" ".join(map(str, args)) + "\n", **kwargs)
            self.log_file.flush()


# READ from std input and feed to SWBBuildService
class STDFeeder:

    def __init__(self, stdin, context: Context):
        from BuildServiceUtils import is_behave_like_proxy

        self.msg_reader = MessageReader()
        self.is_fed = not is_behave_like_proxy()
        self.context = context
        self.stdin = stdin

    async def write_stdin_bytes(self, stdin: asyncio.StreamWriter, byte):
        if byte:
            stdin.write(byte)
            await stdin.drain()  # flush

    async def feed_stdin(self, proc_stdin):
        from BuildServiceUtils import modify_json_content

        byte = None
        while True:
            if self.context.should_exit:
                break

            byte = self.stdin.buffer.read(1)

            if not byte:
                await asyncio.sleep(0.03)
                continue

            self.msg_reader.feed(byte)

            if self.msg_reader.status == MsgStatus.MsgEnd:
                if not self.is_fed:
                    # manipulate message
                    # there can be multiple occurrence of C5 byte, so we need to get the last one
                    json_start = self.msg_reader.buffer[13:].find(b"\xc5")
                    # log(f"CLIENT: JSON_INDEX: {json_start}")

                    if json_start != -1:
                        json_start += 13
                        json_len = int.from_bytes(
                            self.msg_reader.buffer[json_start + 1 : json_start + 3],
                            "big",
                        )
                        new_content, is_fed = modify_json_content(
                            self.msg_reader.buffer[
                                json_start : json_start + 3 + json_len
                            ],
                            json_len,
                        )
                        self.msg_reader.modify_body(
                            new_content, json_start, json_start + 3 + json_len
                        )
                        if is_fed:
                            self.is_fed = True

                buffer = self.msg_reader.buffer.copy()
                self.msg_reader.reset()

                await self.write_stdin_bytes(proc_stdin, buffer)
                self.context.log(f"CLIENT: {str(buffer)}")


# READ from SWBBuildService and write to std output
class STDOuter:

    def __init__(self, stdout, context: Context) -> None:
        self.msg_reader = MessageReader()
        self.context = context
        self.stdout = stdout

    async def write_stdout_bytes(self, out):
        from BuildServiceUtils import push_data_to_stdout

        if hasattr(self.stdout, "buffer"):  # sys.stdout
            await push_data_to_stdout(out, self.stdout)
        else:  # regular file object
            self.stdout.write(out)
            self.stdout.flush()

    async def read_server_data(self, proc_stdout: asyncio.StreamReader):

        while True:
            if self.context.should_exit:
                break
            out = await proc_stdout.read(self.msg_reader.expecting_bytes_from_io())
            if out:
                for b in out:
                    self.msg_reader.feed(b.to_bytes(1))
                    if self.msg_reader.status == MsgStatus.MsgEnd:
                        buffer = self.msg_reader.buffer.copy()
                        self.msg_reader.reset()

                        self.context.log(f"\tSERVER: {buffer[:150]}")
                        await self.write_stdout_bytes(buffer)
            else:
                break  # EOF


async def main(context: Context):
    process = await asyncio.create_subprocess_exec(
        *context.command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE
    )

    try:
        from BuildServiceUtils import check_for_exit

        context.log(os.environ)
        context.log("START")

        reader = STDFeeder(sys.stdin, context)
        outer = STDOuter(
            sys.stdout if context.stdout_file is None else context.stdout_file, context
        )
        asyncio.create_task(reader.feed_stdin(process.stdin))
        asyncio.create_task(outer.read_server_data(process.stdout))
        while True:
            await asyncio.sleep(0.3)
            if await check_for_exit():
                break
    finally:
        process.terminate()
        context.should_exit = True
        sys.exit(0)


def run(context: Context):
    from BuildServiceUtils import make_unblocking

    make_unblocking(sys.stdin)
    make_unblocking(sys.stdout)

    with context as c:
        asyncio.run(main(c))
