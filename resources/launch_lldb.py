#!/usr/bin/env python3
import time
import threading
import os
import helper
import lldb
from attach_lldb import (
    create_apple_runtime_warning_watch_process,
    perform_debugger_command,
)

LOG_DEBUG = 0


# GLOBAL

LOG_FILE = ".logs/lldb_launch.log"


def initialize_log_file():
    """
    Initializes the log file by clearing its contents if debugging is enabled.
    """
    if LOG_DEBUG != 0:
        with open(LOG_FILE, "w", encoding="utf-8") as file:
            file.write("")


initialize_log_file()


log_mutex = threading.Lock()


def log_message(message, file_name=LOG_FILE):
    """
    Logs a message to the specified log file if debugging is enabled.

    :param message: The message to log.
    :param file_name: The file to which the message should be logged.
    """
    if LOG_DEBUG == 0:
        return
    with log_mutex:
        with open(file_name, "a", encoding="utf-8") as _file:
            _file.write(str(message) + "\n")
            _file.flush()


def set_debug_level_launch(
    debugger: lldb.SBDebugger,
    command: str,
    result: lldb.SBCommandReturnObject,
    internal_dict,
):
    """
    Sets the debug level for logging.

    :param debugger: debugger instance
    :param command: The command string.
    :param result: Description
    :param internal_dict: Description
    """
    global LOG_DEBUG

    if command == "debug":
        if LOG_DEBUG == 0:
            LOG_DEBUG = 1
            initialize_log_file()
    else:
        LOG_DEBUG = 0
    log_message(f"Setting debug level to: {command}")


def launch_new_process(
    debugger: lldb.SBDebugger,
    command: str,
    result: lldb.SBCommandReturnObject,
    internal_dict,
):
    """
    Creates a debugging target for the application.

    :param debugger: debugger instance
    :param command: The command string.
    :param result: Description
    :param internal_dict: Description
    """

    def wait_until_build(debugger: lldb.SBDebugger, session_id):
        """
        Waits until the build process is complete.

        :param debugger: debugger instance
        :param session_id: session identifier
        """
        while True:
            if not helper.is_debug_session_valid(session_id):
                perform_debugger_command(debugger, "process detach")
                return "stopped"
            status = helper.get_debugger_launch_config(session_id, "status")
            if status == "launching" or status == "launched":
                return status
            time.sleep(0.3)

    def wait_for_exit_imp():
        log_message("Waiting for exit")
        while True:
            if not helper.is_debug_session_valid(session_id):
                perform_debugger_command(debugger, "process detach")
                return
            time.sleep(0.5)

    try:
        session_id = command
        log_message(
            f"Waiting for build for session id: {session_id}, time: {time.time()}"
        )
        status = wait_until_build(debugger, session_id)
        if status == "stopped":
            return

        log_message(
            f"Creating Session with session id: {session_id}, time: {time.time()}"
        )
        result.AppendMessage(f"Environment: {list}")

        executable = os.getenv("APP_EXE")
        log_message(f"Exe: {executable}")

        helper.update_debugger_launch_config(session_id, "status", "launched")

        if perform_debugger_command(debugger, f"process launch -s -- '{executable}'"):
            # get process pid
            process = debugger.GetSelectedTarget().GetProcess()
            pid = process.GetProcessID()
            log_message(f"Process launched with pid: {pid}, time: {time.time()}")

            threading.Thread(target=wait_for_exit_imp).start()
            helper.update_debugger_launch_config(session_id, "status", "attached")
            create_apple_runtime_warning_watch_process(debugger, str(pid))
        else:
            helper.update_debugger_launch_config(session_id, "status", "stopped")
    except Exception as e:
        log_message(f"{str(e)}, time: {time.time()}")
        helper.update_debugger_launch_config(session_id, "status", "stopped")
