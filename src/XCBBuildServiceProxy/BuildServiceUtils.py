import os

# to update psutil: cd src/XCBBuildServiceProxy && pip install -t lib/ psutil
import lib.psutil as psutil
import base64
import fcntl
import asyncio
import json


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

    # log(f"Original parameters: {content[3:].decode('utf-8')}")

    continue_while_building = os.environ.get("continueBuildingAfterErrors", "False")
    single_file_building = os.environ.get("BUILD_XCODE_SINGLE_FILE_PATH", None)
    # log(f"ENV BUILD_XCODE_SINGLE_FILE_PATH: {single_file_building}")
    # log(f"ENV continueBuildingAfterErrors: {continue_while_building}")

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
    # log("Modified proxy parameters: " + json_str)
    json_bytes = json_str.encode("utf-8")
    json_bytes_len = len(json_bytes)

    res_bytes = bytes([content[0]])
    res_bytes += bytes([json_bytes_len >> 8])
    res_bytes += bytes([json_bytes_len & ((1 << 8) - 1)])
    res_bytes += json_bytes
    return (res_bytes, is_fed)


async def push_data_to_stdout(out, stdout):
    already_written = 0
    while already_written < len(out):
        written = stdout.buffer.write(out[already_written : already_written + 8192])
        if written is None:
            written = 0
        already_written += written
        while True:
            try:
                stdout.flush()
                break
            except BlockingIOError:
                await asyncio.sleep(0.1)


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


def make_unblocking(stream):
    orig_fl = fcntl.fcntl(stream, fcntl.F_GETFL)
    fcntl.fcntl(stream, fcntl.F_SETFL, orig_fl | os.O_NONBLOCK)
