#!/usr/bin/env python3
# This program is for proxy of SWBBuildService, allows you to manipulate with Xcode build on low level
import sys
import os
import asyncio
import subprocess
from MessageReader import MessageReader, MsgStatus
from BuildServiceUtils import (
    get_session_id,
    check_for_exit,
    push_data_to_stdout,
    mtime_of_config_file,
    server_get_message_from_client,
    is_pid_alive,
    is_host_app_alive,
    server_spy_output_file,
)
from MessageModifiers import MessageModifierBase, ClientMessageModifier
from MessageSpy import MessageSpyBase, MessageType
from TargetBuildingMessageSpy import TargetBuildingMessageSpy
from ServerBuildOperationMessageSpy import ServerBuildOperationMessageSpy


class Context:

    def __init__(self, serviceName: str, stdin, stdout, stderr):
        # non zero - write logs from server to input files
        self.debug_mode = 0

        self.stdin = stdin
        self.stdout = stdout
        self.stderr = stderr

        self.serviceName = serviceName
        self.should_exit = False

        # log file for debug info

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
            "SharedFrameworks/SwiftBuild.framework/Versions/A/PlugIns/SWBBuildService.bundle/Contents/MacOS",
        )

        self.is_client = True
        self.session_id = get_session_id()

        def filter_args():
            i = 1
            ret = []
            while i < len(sys.argv):
                if sys.argv[i] == "-proxy-server":
                    self.is_client = False
                    i += 2
                    continue
                ret.append(sys.argv[i])
                i += 1
            return ret

        self.log_file = None

        self.command = [f"{build_service_path}/{serviceName}-origin"] + filter_args()

    def __enter__(self):
        cache_path = os.path.join(
            os.path.expanduser(f"~/Library/Caches/{self.serviceName}Proxy"),
        )

        os.makedirs(cache_path, exist_ok=True)
        self.log_file = open(
            f"{cache_path}/xcbuild_{'server' if not self.is_client else 'client'}.log",
            "w+",
            encoding="utf-8",
        )
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if self.log_file:
            self.log_file.close()

    def log(self, *args, **kwargs):
        if self.debug_mode != 0:
            self.log_file.write(" ".join(map(str, args)) + "\n", **kwargs)
            self.log_file.flush()


def print_raw_bytes_as_hex(byte_data):
    sys.stderr.write("Raw bytes: [")
    for b in byte_data:
        # to int b
        int_val = int(b)
        sys.stderr.write(f"{int_val},")
    sys.stderr.write("]\n")


# READ from std input and feed to SWBBuildService
class STDFeeder:

    def __init__(
        self, stdin, context: Context, request_modifier: MessageModifierBase = None
    ):

        self.msg_reader = MessageReader()
        self.request_modifier = request_modifier
        self.context = context
        self._stdin = stdin
        self._message_spy = None

    @property
    def stdin(self):
        return self._stdin

    @stdin.setter
    def stdin(self, value):
        if self._stdin:
            # if it's a file object, close it
            if not hasattr(self._stdin, "buffer"):  # not sys.stdin
                self._stdin.close()
        self._stdin = value

    @property
    def message_spy(self):
        return self._message_spy

    @message_spy.setter
    def message_spy(self, value: MessageSpyBase):
        self._message_spy = value

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if self._stdin:
            # if it's a file object, close it
            if not hasattr(self._stdin, "buffer"):  # not sys.stdin
                self._stdin.close()
            self._stdin = None

    async def write_stdin_bytes(self, stdin: asyncio.StreamWriter, byte):
        loop = asyncio.get_running_loop()
        if byte:
            stdin.write(byte)
            if isinstance(stdin, asyncio.StreamWriter):
                await stdin.drain()  # flush
            else:
                await loop.run_in_executor(None, stdin.flush)  # flush

    async def feed_stdin(self, proc_stdin):
        byte = None
        loop = asyncio.get_running_loop()
        last_message = None
        try:
            while True:
                if self.context.should_exit:
                    break

                if self.stdin is None:
                    await asyncio.sleep(0.03)
                    continue

                current_reader = self.msg_reader

                if hasattr(self.stdin, "buffer"):  # sys.stdin
                    byte = await loop.run_in_executor(
                        None,
                        self.stdin.buffer.read,
                        self.msg_reader.expecting_bytes_from_io(),
                    )
                else:  # regular file object
                    byte = await loop.run_in_executor(
                        None, self.stdin.read, self.msg_reader.expecting_bytes_from_io()
                    )

                if not byte or current_reader != self.msg_reader:
                    await asyncio.sleep(0.03)
                    continue

                self.msg_reader.feed(byte)

                if self.msg_reader.status == MsgStatus.MsgEnd:
                    last_message = self.msg_reader.buffer.copy()

                    if self.request_modifier:
                        self.request_modifier.modify_content(self.msg_reader)

                    if self.message_spy:
                        await self.message_spy.on_receive_message(
                            MessageType.client_message, self.msg_reader
                        )

                    buffer = self.msg_reader.buffer.copy()
                    self.msg_reader.reset()

                    await self.write_stdin_bytes(proc_stdin, buffer)
                    if self.context.debug_mode:
                        self.context.log(f"CLIENT: {str(buffer[12:])}")
        except Exception as e:
            sys.stderr.write(
                f"Exception in feed_stdin: {e}, message: {str(last_message)}\n"
            )
            print_raw_bytes_as_hex(last_message)
            self.context.should_exit = True


# READ from SWBBuildService and write to std output
class STDOuter:

    def __init__(self, stdout, context: Context) -> None:
        self.msg_reader = MessageReader()
        self.context = context
        self._stdout = stdout
        self._message_spy = None

    @property
    def stdout(self):
        return self._stdout

    @stdout.setter
    def stdout(self, value):
        if self._stdout:
            self._stdout.close()
        self._stdout = value

    @property
    def message_spy(self):
        return self._message_spy

    @message_spy.setter
    def message_spy(self, value: MessageSpyBase):
        self._message_spy = value

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if self._stdout:
            # if it's a file object, close it
            if not hasattr(self._stdout, "buffer"):  # not sys.stdout
                self._stdout.close()
            self._stdout = None

    async def write_stdout_bytes(self, out):
        loop = asyncio.get_running_loop()
        if hasattr(self.stdout, "buffer"):  # sys.stdout
            await push_data_to_stdout(out, self.stdout)
        else:  # regular file object
            await loop.run_in_executor(None, self.stdout.write, out)
            await loop.run_in_executor(None, self.stdout.flush)

    async def read_server_data(self, proc_stdout):
        loop = asyncio.get_running_loop()
        last_message = None
        try:
            while True:
                if self.context.should_exit:
                    break
                if self.stdout is None:
                    await asyncio.sleep(0.03)
                    continue
                current_reader = self.msg_reader
                if isinstance(proc_stdout, asyncio.StreamReader):
                    out = await proc_stdout.read(
                        self.msg_reader.expecting_bytes_from_io()
                    )
                else:
                    out = await loop.run_in_executor(
                        None,
                        proc_stdout.read,
                        self.msg_reader.expecting_bytes_from_io(),
                    )
                if out and current_reader == self.msg_reader:
                    self.msg_reader.feed(out)
                    if self.msg_reader.status == MsgStatus.MsgEnd:
                        buffer = self.msg_reader.buffer.copy()
                        last_message = buffer
                        if self.message_spy:
                            await self.message_spy.on_receive_message(
                                MessageType.server_message, self.msg_reader
                            )

                        self.msg_reader.reset()

                        if self.context.debug_mode:
                            self.context.log(f"\tSERVER: {buffer[12:]}")
                        await self.write_stdout_bytes(buffer)
                else:  # no data
                    await asyncio.sleep(0.03)
        except Exception as e:
            sys.stderr.write(
                f"Exception in read_server_data: {e}, message: {str(last_message)}\n"
            )
            print_raw_bytes_as_hex(last_message)
            self.context.should_exit = True


# Xcode CLIENT
async def xcode_client(context: Context):
    process = await asyncio.create_subprocess_exec(
        *context.command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE
    )
    try:
        context.log(os.environ)
        context.log("START XCODE CLIENT")

        reader = STDFeeder(context.stdin, context)
        outer = STDOuter(context.stdout, context)
        asyncio.create_task(reader.feed_stdin(process.stdin))
        asyncio.create_task(outer.read_server_data(process.stdout))
        while True:
            await asyncio.sleep(0.3)
            if (
                await check_for_exit()
                or process.returncode is not None
                or context.should_exit
            ):
                break
    finally:
        if process.returncode is None:
            process.terminate()
        context.should_exit = True
        sys.exit(0)


def run_xcode_client(context: Context):
    asyncio.run(xcode_client(context))


# CLIENT side
async def main_client(context: Context):
    try:
        context.log(os.environ)
        context.log("START CLIENT")

        reader = STDFeeder(context.stdin, context, ClientMessageModifier())
        outer = STDOuter(context.stdout, context)

        spy_output_file_name = server_spy_output_file()
        if spy_output_file_name:
            spy_output_file = (
                open(spy_output_file_name, "w", encoding="utf-8", buffering=1)
                if spy_output_file_name
                else None
            )
        outer.message_spy = TargetBuildingMessageSpy(
            spy_output_file
        )  # spy target building status and log to stderr
        reader.message_spy = (
            outer.message_spy
        )  # also spy client messages to detect build cancellation

        asyncio.create_task(reader.feed_stdin(context.stdin_file))
        asyncio.create_task(outer.read_server_data(context.stdout_file))
        last_mtime = None
        while True:
            await asyncio.sleep(0.3)

            if (
                await check_for_exit()
                or not is_pid_alive(context.server_pid)
                or context.should_exit
            ):
                break
    finally:
        context.should_exit = True
        spy_output_file.close()
        context.stdin_file.close()
        context.stdout_file.close()
        sys.exit(0)


def run_client(context: Context):
    asyncio.run(main_client(context))


# SERVER side
async def main_server(context: Context):
    process = await asyncio.create_subprocess_exec(
        *context.command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE
    )

    try:
        context.log(os.environ)
        context.log("START SERVER")

        with STDFeeder(None, context) as reader, STDOuter(None, context) as outer:
            message_spy = ServerBuildOperationMessageSpy()
            outer.message_spy = message_spy
            reader.message_spy = message_spy
            asyncio.create_task(reader.feed_stdin(process.stdin))
            asyncio.create_task(outer.read_server_data(process.stdout))
            last_mtime = None
            while True:
                await asyncio.sleep(0.3)
                new_mtime = mtime_of_config_file()
                # we don't want to change the client while it's building as it would be wrongly report messages to new client
                if new_mtime != last_mtime and not message_spy.is_building:
                    last_mtime = new_mtime
                    try:
                        message = server_get_message_from_client()
                    except Exception as e:
                        context.log(
                            f"SERVER: Exception getting message from client: {e}"
                        )
                        message = None
                    if not message:
                        continue

                    # expected messages:
                    # { "command": "build", "stdin_file": "...", "stdout_file": "..." }
                    # { "command": "stop" }
                    if message["command"] == "build":
                        stdin_file_path = message["stdin_file"]
                        stdout_file_path = message["stdout_file"]
                        if (
                            reader.stdin
                            and outer.stdout
                            and stdin_file_path == reader.stdin.name
                            and stdout_file_path == outer.stdout.name
                        ):
                            # same client, no need to change pipes
                            continue

                        if reader.stdin:
                            reader.stdin.close()
                        reader.stdin = open(stdin_file_path, "rb")
                        reader.msg_reader = MessageReader()

                        if outer.stdout:
                            outer.stdout.close()
                        outer.stdout = open(stdout_file_path, "wb")

                    elif message["command"] == "stop":
                        break
                else:
                    if (
                        process.returncode is not None
                        or not is_host_app_alive()
                        or context.should_exit
                    ):
                        context.log(
                            f"SERVER: SWBBuildService Process exited with {process.returncode}, or host app not alive"
                        )
                        break

    finally:
        if process.returncode is None:
            process.terminate()
        context.should_exit = True
        sys.exit(0)


def run_server(context: Context):
    asyncio.run(main_server(context))
