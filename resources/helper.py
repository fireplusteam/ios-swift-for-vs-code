#!/usr/bin/env python3
import subprocess
import json
import os
import time
import signal

# to update psutil: cd resources && pip install -t lib/ filelock
import lib.filelock as fileLock


def get_list_of_pids(process_name: str):
    """
    Get list of PIDs for the given process name.

    :param process_name: process name to search for
    :type process_name: str
    """
    proc = subprocess.run(["ps", "aux"], capture_output=True, text=True, check=True)

    # print(proc.stdout)

    # Split the output into lines
    lines = proc.stdout.split("\n")

    result = set()

    def has_process_name(line: str) -> bool:
        index = 0
        while index < len(line):
            index = line.find(process_name, index)
            if index == -1:
                return False
            if index + len(process_name) == len(line) or (
                index + len(process_name) < len(line)
                and line[index + len(process_name)] in " \t"
            ):  # end of line or followed by whitespace
                return True
            index += len(process_name)
        return False

    for line in lines[1:]:  # Skip the header line
        columns = line.split()
        if len(line) == 0:
            break

        proc_start = line.find(columns[9]) + len(columns[9])
        proc_line = line[proc_start:].strip()
        if len(columns) >= 2 and has_process_name(proc_line):
            pid = columns[1]
            result.add(pid)

    return result


class ProcessError(Exception):
    """
    Exception for process-related errors (dead, zombie, etc.).
    """

    pass


class Process:
    """
    Represents a system process identified by its PID.
    """

    def __init__(self, pid: str):
        self.pid = pid

    def suspend(self):
        """
        Suspend the process.
        """
        os.kill(int(self.pid), signal.SIGSTOP)

    def resume(self):
        """Resume the process."""
        os.kill(int(self.pid), signal.SIGCONT)

    def status(self) -> str:
        """get process status"""
        result = subprocess.run(
            ["ps", "-o", "state=", "-p", str(self.pid)],
            capture_output=True,
            text=True,
            check=True,
        )
        if "X" in result.stdout:
            raise ProcessError("Process is dead")
        if "Z" in result.stdout:
            raise ProcessError("Process is a zombie")

        return result.stdout.strip()


def get_process_by_pid(pid: str) -> Process:
    """
    get Process object by PID

    :param pid: process identifier
    :type pid: str
    :return: Process object or None if not found
    :rtype: Process
    """
    process = Process(pid)
    return process


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
DEBUGGER_CONFIG_FILE_LOCK = f"{DEBUGGER_CONFIG_FILE}.lock"


def wait_debugger_to_action(session_id, actions: list[str]):
    """
    Wait until the debugger session reaches one of the given actions.

    :param session_id: Debugger session identifier
    :param actions: List of actions to wait for
    :type actions: list[str]
    """
    while True:
        with fileLock.FileLock(DEBUGGER_CONFIG_FILE_LOCK):
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
        with fileLock.FileLock(DEBUGGER_CONFIG_FILE_LOCK):
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
    with fileLock.FileLock(DEBUGGER_CONFIG_FILE_LOCK):
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
        with fileLock.FileLock(DEBUGGER_CONFIG_FILE_LOCK):
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
