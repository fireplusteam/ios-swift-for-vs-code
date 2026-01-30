#!/usr/bin/env python3
# This program is for proxy of XCBBuildService, allows you to manipulate with XCode build on low level
import base64
import sys
import os
import json
import fcntl
import asyncio
import psutil  # pip install psutil
import subprocess
from MessageReader import MessageReader, MsgStatus


# debugpy.listen(5678)
# debugpy.wait_for_client()

cache_path: str = ""

# 0 - simple repeater
# 1 - proxy
MODE = 1

# 0 - no debug files
# 1 - read from input
# 2 - write logs from server to input files
DEBUG_FROM_FILE = 2

input = None
output = None
command = None

SHOULD_EXIT = False

STDOUT_FILE_NAME = None
STDOUT_FILE = None


def configure(serviceName: str):
    """
    Service name: For old Xcode versions it is XCBBuildService, for new ones SWBBuildService

    :param serviceName: Description
    :type serviceName: str
    """
    global log_file, MODE, DEBUG_FROM_FILE, cache_path, input, output, command, STDOUT_FILE_NAME
    cache_path = os.path.join(
        os.path.expanduser(f"~/Library/Caches/{serviceName}Proxy"),
    )

    os.makedirs(cache_path, exist_ok=True)
    log_file = open(f"{cache_path}/xcbuild.log", "w+")  # //"/tmp/xcbuild.diags"

    xcode_dev_path = (
        subprocess.run("xcode-select -p", shell=True, capture_output=True, check=True)
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

    command = [f"{build_service_path}/{serviceName}-origin"]
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == "-log-file-name-proxy":
            STDOUT_FILE_NAME = sys.argv[i + 1]
            i += 2
        else:
            command.append(sys.argv[i])
            i += 1

    match DEBUG_FROM_FILE:
        case 0:
            pass
        case 1:
            input = open(f"{cache_path}/in", "r")
            sys.stdin = input
        case 2:
            input = open(f"{cache_path}/in", "wb")
            output = open(f"{cache_path}/out", "wb")


# ----------------UTILS------------------------


def log(*args, **kwargs):
    if DEBUG_FROM_FILE != 0:
        log_file.write(" ".join(map(str, args)) + "\n", **kwargs)
        log_file.flush()


def is_behave_like_proxy():
    if (
        "continueBuildingAfterErrors" in os.environ
        or "BUILD_XCODE_SINGLE_FILE_PATH" in os.environ
    ):
        return True
    return False


# c5 xx xx - format of json data
def modify_json_content(content, content_len):
    is_fed = False
    # first two bytes is the length of json
    assert content_len == int(content[1]) * 256 + content[2]

    log(f"Original parameters: {content[3:].decode('utf-8')}")

    continue_while_building = os.environ.get("continueBuildingAfterErrors", "False")
    single_file_building = os.environ.get("BUILD_XCODE_SINGLE_FILE_PATH", None)
    log(f"ENV BUILD_XCODE_SINGLE_FILE_PATH: {single_file_building}")
    log(f"ENV continueBuildingAfterErrors: {continue_while_building}")

    config = json.loads(content[3:])

    # if False:
    if (
        "request" in config
        and "continueBuildingAfterErrors" in config["request"]
        and continue_while_building == "True"
    ):
        is_fed = True

        config["request"]["continueBuildingAfterErrors"] = True

        jsonRepresentation = config["request"]["jsonRepresentation"]
        jsonRepresentation = base64.b64decode(jsonRepresentation)
        # log("based64 origin: ")
        # log(jsonRepresentation)

        # modify json representation. NOTE: should be the same as config["request"]
        jsonRepresentation = json.loads(jsonRepresentation)
        jsonRepresentation["continueBuildingAfterErrors"] = True

        if (
            not single_file_building is None
        ):  # make a build command like for a single file
            buildCommand = {
                "command": "singleFileBuild",
                "files": [single_file_building],
            }
            config["request"]["buildCommand"] = buildCommand
            jsonRepresentation["buildCommand"] = buildCommand

        jsonRepresentation = json.dumps(
            jsonRepresentation, separators=(",", " : "), indent="  "
        )
        # log("base64 modified:")
        # log(jsonRepresentation.encode("utf-8"))
        jsonRepresentation = base64.b64encode(jsonRepresentation.encode("utf-8"))
        config["request"]["jsonRepresentation"] = jsonRepresentation.decode("utf-8")

    json_str = json.dumps(config, separators=(",", ":"))
    log("Modified proxy parameters: " + json_str)
    json_bytes = json_str.encode("utf-8")
    json_bytes_len = len(json_bytes)

    res_bytes = bytes([content[0]])
    res_bytes += bytes([json_bytes_len >> 8])
    res_bytes += bytes([json_bytes_len & ((1 << 8) - 1)])
    res_bytes += json_bytes
    return (res_bytes, is_fed)


# Read stdin byte by byte
class STDFeeder:

    def __init__(self):
        self.msg_reader = MessageReader()
        self.is_fed = not is_behave_like_proxy()

    async def write_stdin_bytes(self, stdin: asyncio.StreamWriter, byte):
        if byte:
            stdin.write(byte)
            await stdin.drain()  # flush

    async def feed_stdin(self, stdin):
        byte = None
        while True:
            if SHOULD_EXIT:
                break

            byte = sys.stdin.buffer.read(1)

            if not byte:
                await asyncio.sleep(0.03)
                continue

            if DEBUG_FROM_FILE == 2:
                input.write(byte)
                input.flush()

            match MODE:
                case 0:
                    await self.write_stdin_bytes(stdin, byte)
                case 1:
                    self.msg_reader.feed(byte)

                    if self.msg_reader.status == MsgStatus.MsgEnd:
                        if not self.is_fed:
                            # manipulate message
                            # there can be multiple occurrence of C5 byte, so we need to get the last one
                            json_start = self.msg_reader.buffer[13:].find(b"\xc5")
                            log(f"CLIENT: JSON_INDEX: {json_start}")

                            if json_start != -1:
                                json_start += 13
                                json_len = int.from_bytes(
                                    self.msg_reader.buffer[
                                        json_start + 1 : json_start + 3
                                    ],
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

                        await self.write_stdin_bytes(stdin, buffer)
                        log(f"CLIENT: {str(buffer[13:])}")


def is_parent_process_alive():
    ppid = os.getppid()
    if psutil.pid_exists(ppid):
        parent = psutil.Process(ppid)
        gppid = parent.ppid()
        # log(gppid)
        if gppid == 0 or gppid == 1:  # if parent if launcher then it can be killed
            return False
        else:
            return True
    else:
        return False


async def check_for_exit():
    if not is_parent_process_alive():
        return True

    return False


# Write to stdout all got reponse from XCBBuildService
class STDOuter:

    def __init__(self) -> None:
        self.msg_reader = MessageReader()

    async def on_error_of_reading_data(self):
        await asyncio.sleep(0.05)

    async def write_stdout(self, out):
        if STDOUT_FILE is None:
            already_written = 0
            while already_written < len(out):
                written = sys.stdout.buffer.write(
                    out[already_written : already_written + 1024]
                )
                assert written is not None
                already_written += written
                sys.stdout.flush()

        if STDOUT_FILE is not None:
            written = STDOUT_FILE.write(out)
            assert written == len(out)
            STDOUT_FILE.flush()

        if DEBUG_FROM_FILE == 2:
            written = output.write(out)
            assert written == len(out)
            output.flush()

    async def read_server_data(self, stdout: asyncio.StreamReader):
        while True:
            try:
                if SHOULD_EXIT:
                    break

                out = await stdout.read(1)
                if out:
                    self.msg_reader.feed(out)
                    if self.msg_reader.status == MsgStatus.MsgEnd:
                        buffer = self.msg_reader.buffer.copy()
                        self.msg_reader.reset()

                        if DEBUG_FROM_FILE != 0:
                            log(f"\tSERVER: {buffer[13:150]}")
                        await self.write_stdout(buffer)
                else:
                    await self.on_error_of_reading_data()
            except:
                await self.on_error_of_reading_data()


async def main():
    global SHOULD_EXIT
    process = await asyncio.create_subprocess_exec(
        *command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE
    )

    try:
        log(os.environ)
        log("START")

        reader = STDFeeder()
        outer = STDOuter()
        asyncio.create_task(reader.feed_stdin(process.stdin))
        asyncio.create_task(outer.read_server_data(process.stdout))
        while True:
            await asyncio.sleep(0.3)
            if await check_for_exit():
                break
    finally:
        process.terminate()
        SHOULD_EXIT = True
        sys.exit(0)


def make_unblocking(stream):
    orig_fl = fcntl.fcntl(stream, fcntl.F_GETFL)
    fcntl.fcntl(stream, fcntl.F_SETFL, orig_fl | os.O_NONBLOCK)


def run():
    global STDOUT_FILE
    make_unblocking(sys.stdin)
    make_unblocking(sys.stdout)

    if STDOUT_FILE_NAME is not None:
        with open(STDOUT_FILE_NAME, "wb", buffering=0) as temp_file:
            STDOUT_FILE = temp_file
            asyncio.run(main())
    else:
        asyncio.run(main())
