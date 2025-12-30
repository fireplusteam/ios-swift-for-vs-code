#!/usr/bin/env python3
from enum import Enum
import fcntl
import time
import subprocess
import threading
import os
import helper
import lldb
from app_log import AppLogger
import runtime_warning_database

LOG_DEBUG = 0


def create_app_logger():
    """
    Creates and returns an instance of AppLogger.
    """
    _app_logger = AppLogger("")
    return _app_logger


# GLOBAL
app_logger = create_app_logger()

LOG_FILE = ".logs/lldb.log"


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


def perform_debugger_command(debugger: lldb.SBDebugger, command: str) -> bool:
    """
    Executes a command in the LLDB debugger and logs the result.

    :param debugger: debugger instance
    :param command: The command to execute.
    :return: The result of the command execution.
    """
    if isinstance(debugger, lldb.SBTarget):
        debugger = debugger.GetDebugger()
    log_message(f"Debugger: {str(debugger)}, time: {time.time()}")
    log_message(f"Command: {str(command)}, time: {time.time()}")
    try:
        interpreter = debugger.GetCommandInterpreter()
        return_object = lldb.SBCommandReturnObject()
        interpreter.HandleCommand(command, return_object)
        log_message(
            f"Result Command: {str(command)}, return object: {str(return_object)}, time: {time.time()}"
        )
        return return_object.Succeeded()
    except Exception as e:
        log_message(f"Error executing command: {str(e)}, time: {time.time()}")
        return False


def kill_codelldb(debugger: lldb.SBDebugger):
    """
    Kills the codelldb stub process.

    :param debugger: debugger instance
    """
    script_path = os.getenv("SCRIPT_PATH")
    perform_debugger_command(debugger, f"target create {script_path}/lldb_exe_stub")
    process = subprocess.Popen(f"{script_path}/lldb_exe_stub")
    perform_debugger_command(debugger, f"process attach --pid {process.pid}")


runtime_warning_process: subprocess.Popen = None


def create_apple_runtime_warning_watch_process(debugger: lldb.SBDebugger, pid: str):
    """
    Creates a process to watch Apple runtime warnings for a given process ID.

    :param debugger: debugger instance
    :param pid: process identifier
    """
    global runtime_warning_process
    try:
        device_id = os.getenv("DEVICE_ID").strip("\n")

        if os.getenv("PLATFORM").strip('"') == "macOS":
            log_message("Runtime warnings are not supported for MacOS apps")
            return

        command = f"xcrun simctl spawn {device_id} log stream --level debug --style syslog --color none --predicate 'subsystem CONTAINS \"com.apple.runtime-issues\" AND processIdentifier == {pid}'"
        log_message(f"Watching runtime warning command: {command}")

        runtime_warning_process = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        flags = fcntl.fcntl(
            runtime_warning_process.stdout, fcntl.F_GETFL
        )  # first get current process.stdout flags
        fcntl.fcntl(
            runtime_warning_process.stdout, fcntl.F_SETFL, flags | os.O_NONBLOCK
        )
    except Exception as e:
        log_message(f"Error on watching {e}")


def print_app_log(debugger: lldb.SBDebugger, pid: str):
    """
    Prints the application log for a given process ID.

    :param debugger: debugger instance
    :param pid: process identifier
    """
    log_message(f"Waiting for logs, pid: {pid}")

    try:
        scheme = os.getenv("PROJECT_SCHEME").strip('"')
        device = os.getenv("DEVICE_ID").strip('"')
        platform = os.getenv("PLATFORM").strip('"')
        log_message(f"SCHEME: {scheme}, device: {device}, platform: {platform}")
        app_logger.file_path = f".logs/app_{device}.log"
        app_logger.watch_app_log()
    except Exception as e:
        print(f"Printer crashed: {str(e)}")


def wait_for_process(
    process_name: str,
    debugger: lldb.SBDebugger,
    existing_pids: set[str],
    session_id: str,
):
    """
    Waits for a new process with the specified name to start and attaches the debugger to it.

    :param process_name: Name of the process to wait for.
    :param debugger: debugger instance
    :param existing_pids: List of existing process IDs
    :param session_id: debug session identifier
    """

    class ProcessAttachState(Enum):
        """
        Enum representing the state of process attachment.
        """

        NOT_ATTACHED = 0
        ATTACHING = 1
        ATTACHED = 2
        DETACHED = 3

    process_attach_state = ProcessAttachState.NOT_ATTACHED
    try:
        log_message(f"Waiting for process: {process_name}")
        log_message(f"Session_id: {session_id}")
        check_debug_session_last_time = time.time()
        while True:
            if check_debug_session_last_time + 1.5 < time.time():
                if not helper.is_debug_session_valid(session_id):
                    process_attach_state = ProcessAttachState.DETACHED
                    kill_codelldb(debugger)
                    log_message(
                        "Debug session is no longer valid, stopping wait_for_process"
                    )
                    return
                check_debug_session_last_time = time.time()

            new_pids = [
                x
                for x in helper.get_list_of_pids(process_name)
                if x not in existing_pids
            ]
            # log_message(f"New pids found: {','.join(new_pids)}")

            if len(new_pids) > 0:
                pid = new_pids.pop()
                process = helper.get_process_by_pid(pid)

                # process attach command sometimes fails to stop the process, so we try to do it manually before attaching
                # if we can not do it either way, process would be detached from debugger silently and all status of tests would be lost
                process.suspend()

                def suspending():
                    # repeatly suspend the process until it's fully attached as lldb only sunspends it once during attach but process can not react in all cases
                    # so we keep suspending it until it's fully attached
                    try:
                        while process_attach_state == ProcessAttachState.ATTACHING:
                            process.suspend()
                            time.sleep(0.001)
                    except Exception as e:
                        log_message(
                            f"Error on suspending process pid: {pid}, error: {str(e)}, time: {time.time()}"
                        )
                    finally:
                        process.resume()

                def wait_for_exit():
                    log_message("Waiting for exit")
                    while True:
                        if not helper.is_debug_session_valid(session_id):
                            perform_debugger_command(debugger, "process detach")
                            return
                        time.sleep(0.5)

                process_attach_state = ProcessAttachState.ATTACHING
                threading.Thread(target=suspending).start()

                if LOG_DEBUG != 0:
                    log_message(
                        f"Attaching to pid: {pid}, process status: {str(process.status())}, time: {time.time()}"
                    )
                attach_command = f"process attach --pid {pid}"
                if perform_debugger_command(debugger, attach_command):
                    log_message(
                        f"Process attached successfully to pid: {pid}, time: {time.time()}"
                    )
                    threading.Thread(target=wait_for_exit).start()

                    process_attach_state = ProcessAttachState.ATTACHED

                    helper.update_debugger_launch_config(
                        session_id, "status", "attached"
                    )

                    threading.Thread(target=print_app_log, args=(debugger, pid)).start()
                    create_apple_runtime_warning_watch_process(debugger, pid)
                else:
                    process_attach_state = ProcessAttachState.DETACHED
                    kill_codelldb(debugger)
                    log_message(
                        f"Failed to attach to process with pid: {pid}, time: {time.time()}"
                    )

                return

            time.sleep(0.001)
    except (subprocess.SubprocessError, helper.ProcessError) as proc_e:
        process_attach_state = ProcessAttachState.DETACHED
        log_message(
            f"Process disappeared before attaching to pid: {pid}, error: {str(proc_e)}, time: {time.time()}"
        )
    except Exception as e:
        process_attach_state = ProcessAttachState.DETACHED
        log_message(
            f"Error on waiting for process: {str(e)}, pid: {pid}, time: {time.time()}"
        )


def watch_new_process(
    debugger: lldb.SBDebugger,
    command: str,
    result: lldb.SBCommandReturnObject,
    internal_dict,
):
    """
    Watches for a new process to start and attaches the debugger to it.

    :param debugger:debugger instance
    :param command: The command containing the session ID.
    :param result: Description
    :param internal_dict: Description
    """
    log_message("Debugger: " + str(debugger))

    log_message(f"Watching command: {command}")
    commands = command.split(" ")

    session_id = commands[0]
    if not helper.is_debug_session_valid(session_id):
        kill_codelldb(debugger)
        return

    process_name = os.getenv("PROCESS_EXE")
    log_message(f"Process name to watch: {process_name}")
    existing_pids = helper.get_list_of_pids(process_name)
    log_message(
        f"Existing pids {','.join(existing_pids)} for Process name {process_name}, session id: {session_id}"
    )
    helper.update_debugger_launch_config(session_id, "status", "launched")
    wait_for_process(process_name, debugger, existing_pids, session_id)


mutex_log_runtime_error = threading.Lock()


def log_runtime_error(debugger: lldb.SBDebugger, json):
    """
    Logs a runtime error from the runtime warning process.

    :param debugger: debugger instance
    :param json: JSON representation of the runtime error
    """
    if not runtime_warning_process:
        return

    with mutex_log_runtime_error:
        last_line = None
        while True:
            try:
                input_line = runtime_warning_process.stdout.readline()
                if not input_line:
                    if not last_line:
                        continue
                    if last_line.find("[com.apple.runtime-issues") == -1:
                        continue

                    break
                last_line = input_line
                if last_line.find("[com.apple.runtime-issues") != -1:
                    break
                # log_message(input_line)
            except:
                if not last_line or last_line.find("[com.apple.runtime-issues") == -1:
                    continue
                break
        try:
            runtime_warning_database.store_runtime_warning(last_line, json)
            log_message(last_line)
            # log_message(json)
        except Exception as e:
            log_message(f"Error logging to runtime database: {str(e)}")


def print_runtime_warning(
    debugger: lldb.SBDebugger,
    command: str,
    result: lldb.SBCommandReturnObject,
    internal_dict,
):
    """
    Prints the runtime app warning information.

    :param debugger: debugger instance
    :param command: The command string.
    :param result: Description
    :param internal_dict: Description
    """
    if isinstance(debugger, lldb.SBTarget):
        debugger = debugger.GetDebugger()
    try:
        target: lldb.SBTarget = debugger.GetSelectedTarget()
        process: lldb.SBProcess = target.GetProcess()
        thread: lldb.SBThread = process.GetSelectedThread()
        frame: lldb.SBFrame = thread.GetSelectedFrame()

        def bt_to_json(lldb_frame: lldb.SBFrame):
            thread: lldb.SBThread = lldb_frame.GetThread()
            frames = []
            for frame in thread:
                line_entry: lldb.SBLineEntry = frame.GetLineEntry()
                file_spec: lldb.SBFileSpec = line_entry.GetFileSpec()
                frame_info = frozenset(
                    {
                        "index": frame.idx,
                        "function": frame.GetFunctionName(),
                        "file": file_spec.fullpath,
                        "line": line_entry.GetLine(),
                        "column": line_entry.GetColumn(),
                    }.items()
                )
                frames.append(frame_info)
            return frames

        frame = bt_to_json(frame)
        threading.Thread(target=log_runtime_error, args=(debugger, frame)).start()

    except Exception as e:
        log_message("---------------Runtime warning error:\n" + str(e))
    log_message("Logged runtime warning")


def wait_until_build(debugger: lldb.SBDebugger, session_id: str):
    """
    Waits until the build process is complete.

    :param debugger: debugger instance
    :param session_id: session identifier
    """
    while True:
        if not helper.is_debug_session_valid(session_id):
            kill_codelldb(debugger)
            return "stopped"
        status = helper.get_debugger_launch_config(session_id, "status")
        if status == "launching" or status == "launched":
            return status
        time.sleep(0.3)


def set_environmental_var(
    debugger: lldb.SBDebugger,
    command: str,
    result: lldb.SBCommandReturnObject,
    internal_dict,
):
    """
    Sets an environmental variable.

    :param debugger: debugger instance
    :param command: The command string.
    :param result: Description
    :param internal_dict: Description
    """
    key, value = command.split("=!!=")
    os.environ.setdefault(key, value)


def set_debug_level(
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


def create_target(
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
    try:
        session_id = command
        status = wait_until_build(debugger, session_id)
        if status == "stopped":
            return

        app_logger.session_id = session_id
        log_message(f"Creating Session with session id: {session_id}")
        result.AppendMessage("Start lldb watching new instance of App")

        result.AppendMessage(f"Environment: {list}")

        executable = os.getenv("APP_EXE")
        log_message(f"Exe: {executable}")
        result.AppendMessage(f"Creating {executable}")
        perform_debugger_command(debugger, f'target create "{executable}"')
        result.AppendMessage(str(debugger.GetSelectedTarget()))
        result.AppendMessage(f"Target created for {executable}")
        # Set common breakpoints, so if tests are running with debugger, so it's caught
        # deprecated
        # breakpoint on test failed
        # perform_debugger_command(debugger, "breakpoint set --selector recordFailureWithDescription:inFile:atLine:expected:")
        # perform_debugger_command(debugger, "breakpoint set --name _XCTFailureHandler")
        # breakpoint on runtime warning
        # perform_debugger_command(debugger, "breakpoint set --name os_log_fault_default_callback")
        # catch the runtime crash
        perform_debugger_command(
            debugger, "breakpoint set --name __exceptionPreprocess"
        )

    except Exception as e:
        log_message(str(e))


def app_log(
    debugger: lldb.SBDebugger,
    command: str,
    result: lldb.SBCommandReturnObject,
    internal_dict,
):
    """
    On/off application logging.

    :param debugger: debugger instance
    :param command: The command string.
    :param result: Description
    :param internal_dict: Description
    """
    if command == "on":
        app_logger.enabled = True
        result.AppendMessage("App Logger Turned On")
    elif command == "off":
        app_logger.enabled = False
        result.AppendMessage("App Logger Turned Off")
    else:
        result.AppendMessage("Valid value of app_log command is <on/off>")


def terminate_debugger(
    debugger: lldb.SBDebugger,
    command: str,
    result: lldb.SBCommandReturnObject,
    internal_dict,
):
    """
    Terminates the debugger process.

    :param debugger: debugger instance
    :param command: The command string.
    :param result: Description
    :param internal_dict: Description
    """
    perform_debugger_command(debugger, "process detach")
