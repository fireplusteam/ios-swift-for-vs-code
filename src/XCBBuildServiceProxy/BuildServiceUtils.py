import os
import fcntl
import asyncio
import json

# to update psutil: cd src/XCBBuildServiceProxy && pip install -t lib/ psutil
import lib.psutil as psutil

# to update psutil: cd src/XCBBuildServiceProxy && pip install -t lib/ filelock
import lib.filelock as filelock


def is_behave_like_proxy():
    if (
        "continueBuildingAfterErrors" in os.environ
        or "BUILD_XCODE_SINGLE_FILE_PATH" in os.environ
    ):
        return True
    return False


def server_spy_output_file():
    if "SWBBUILD_SERVICE_PROXY_SERVER_SPY_OUTPUT_FILE" in os.environ:
        return os.environ["SWBBUILD_SERVICE_PROXY_SERVER_SPY_OUTPUT_FILE"]
    return None


def get_session_id():
    if "SWBBUILD_SERVICE_PROXY_SESSION_ID" in os.environ:
        return os.environ["SWBBUILD_SERVICE_PROXY_SESSION_ID"]
    return "TEST_SESSION_ID_12345"


def config_file():
    if "SWBBUILD_SERVICE_PROXY_CONFIG_PATH" in os.environ:
        return os.environ["SWBBUILD_SERVICE_PROXY_CONFIG_PATH"]
    return "/tmp/SWBBUILD_SERVICE_PROXY_CONFIG_PATH.json"


def is_host_app_alive():
    pid = os.environ["SWBBUILD_SERVICE_PROXY_HOST_APP_PROCESS_ID"]
    return is_pid_alive(int(pid))


def client_put_message_to_server(message: str):
    config_file_path = config_file()
    if config_file_path is None:
        return

    os.makedirs(os.path.dirname(config_file_path), exist_ok=True)
    lock_path = config_file_path + ".lock"
    with filelock.FileLock(lock_path, timeout=5):
        with open(config_file_path, "w", encoding="utf-8") as f:
            json.dump(message, f)


def mtime_of_config_file():
    config_file_path = config_file()
    if config_file_path is None:
        return None

    if not os.path.exists(config_file_path):
        return None

    return os.path.getmtime(config_file_path)


def server_get_message_from_client():
    config_file_path = config_file()
    if config_file_path is None:
        return None

    lock_path = config_file_path + ".lock"
    with filelock.FileLock(lock_path, timeout=5):
        if not os.path.exists(config_file_path):
            return None
        with open(config_file_path, "r", encoding="utf-8") as f:
            cnt = f.read()
            return json.loads(cnt)


def is_pid_alive(pid: int):
    if psutil.pid_exists(pid):
        return True
    return False


def get_server_pid_by_session_id(session_id: str):
    if session_id is None:
        return False
    # find pid of server with command line argument session_id
    for proc in psutil.process_iter(["pid", "cmdline"]):
        try:
            cmdline = proc.info["cmdline"]
            if cmdline and session_id in " ".join(cmdline):
                pid = proc.info["pid"]
                return pid
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    return None


async def push_data_to_stdout(out, stdout):
    already_written = 0
    loop = asyncio.get_running_loop()
    while already_written < len(out):
        written = await loop.run_in_executor(
            None, stdout.buffer.write, out[already_written:]
        )
        if written is None:
            written = 0
        already_written += written
        while True:
            try:
                await loop.run_in_executor(None, stdout.flush)
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
