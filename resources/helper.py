#!/usr/bin/env python3
# import subprocess
import json
import os
import time
import fileLock

# to update psutil: cd resources && pip install -t lib/ psutil
import lib.psutil as psutil


def get_list_of_pids(process_name: str):
    """
    Get list of PIDs for the given process name.

    :param process_name: process name to search for
    :type process_name: str
    """
    result = set()
    for proc in psutil.process_iter():
        try:
            if process_name == proc.name():
                result.add(str(proc.pid))
        except:
            pass
    return result


def get_process_by_pid(pid: int) -> psutil.Process:
    """
    get Process object by PID

    :param pid: process identifier
    :type pid: int
    :return: Process object or None if not found
    :rtype: Process
    """
    try:
        process = psutil.Process(pid)
        return process
    except psutil.NoSuchProcess:
        return None


# just get all process names (for debug purposes)
# def get_list_of_procs():
#     result = set()
#     for proc in psutil.process_iter():
#         try:
#             result.add(proc.name())
#         except:
#             pass
#     return result


# --------GIT-------------------------------------


def update_git_exclude(file_to_exclude):
    """
    Update .git/info/exclude to add the given file to be ignored by git.

    :param file_to_exclude: file path to exclude
    """
    if not os.path.exists(".git"):
        return
    os.makedirs(".git/info", exist_ok=True)
    content = None
    try:
        with open(".git/info/exclude", "r") as file:
            content = file.readlines()
    except:
        pass
    # print(f"Updating git ignore: {content}")
    if content is None:
        content = []
    if len([x for x in content if f"{file_to_exclude}".strip() == x.strip()]) == 0:
        content.insert(0, f"{file_to_exclude}\n")
        # print(f"CHANGED: {content}")
        try:
            with open(".git/info/exclude", "w+") as file:
                file.write("".join(content))
        except Exception as e:
            print(f"Git ignore update exception: {str(e)}")


# ---------DEBUGGER--------------------------------
DEBUGGER_CONFIG_FILE = ".vscode/xcode/debugger.launching"


def wait_debugger_to_action(session_id, actions: list[str]):
    """
    Wait until the debugger session reaches one of the given actions.

    :param session_id: Debugger session identifier
    :param actions: List of actions to wait for
    :type actions: list[str]
    """
    while True:
        with fileLock.FileLock(DEBUGGER_CONFIG_FILE):
            with open(DEBUGGER_CONFIG_FILE, "r", encoding="utf-8") as file:
                config = json.load(file)
        if config is not None and not session_id in config:
            break

        if config is not None and config[session_id]["status"] in actions:
            break

        time.sleep(1)


def is_debug_session_valid(session_id) -> bool:
    """
    Checks if the debug session with the given session ID is valid. A session is considered invalid if it is marked as "stopped" in the debugger configuration file.

    :param session_id: Debugger session identifier
    :return: True if the session is valid, False otherwise
    :rtype: bool
    """
    try:
        with fileLock.FileLock(DEBUGGER_CONFIG_FILE):
            with open(DEBUGGER_CONFIG_FILE, "r", encoding="utf-8") as file:
                config = json.load(file)
            if not session_id in config:
                return False
            if config[session_id]["status"] == "stopped":
                return False

            return True
    except:  # no file or a key, so the session is valid
        return True


def get_debugger_launch_config(session_id, key):
    """
    Get the debugger launch configuration for the given session ID and key.

    :param session_id: Debugger session identifier
    :param key: Configuration key
    """
    with fileLock.FileLock(DEBUGGER_CONFIG_FILE):
        with open(DEBUGGER_CONFIG_FILE, "r", encoding="utf-8") as file:
            config = json.load(file)
            if config is not None and not session_id in config:
                return None

            if config is not None and config[session_id][key]:
                return config[session_id][key]


def update_debugger_launch_config(session_id, key, value):
    """
    Update the debugger launch configuration for the given session ID, key, and value.

    :param session_id: Debugger session identifier
    :param key: Configuration key
    :param value: Configuration value
    """
    config = {}
    try:
        with fileLock.FileLock(DEBUGGER_CONFIG_FILE):
            if os.path.exists(DEBUGGER_CONFIG_FILE):
                try:
                    with open(DEBUGGER_CONFIG_FILE, "r+", encoding="utf-8") as file:
                        config = json.load(file)
                except:
                    pass

            if session_id in config:
                # stopped can not be updated once reported
                if (
                    key == "status"
                    and key in config[session_id]
                    and config[session_id][key] == "stopped"
                ):
                    return
                config[session_id][key] = value
            else:
                config[session_id] = {}
                config[session_id][key] = value

            with open(DEBUGGER_CONFIG_FILE, "w+", encoding="utf-8") as file:
                json.dump(config, file, indent=2)
    except:
        pass  # config is empty


if __name__ == "__main__":
    print("ok")

# ---------------------BINARY READER HELPER----------------------------


def binary_readline(file, newline=b"\r\n"):
    """
    Read a line from a binary file until the specified newline sequence.

    :param file: Binary file object
    :param newline: Newline sequence to read until
    """
    line = bytearray()
    while True:
        x = file.read(1)
        if x:
            line += x
        else:
            if len(line) == 0:
                return None
            else:
                return line

        if line.endswith(newline):
            return line
