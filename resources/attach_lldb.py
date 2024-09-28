#!/usr/bin/env python3
import fcntl
import lldb
import time
import subprocess
import helper
import threading
from app_log import AppLogger
import time
import os
import runtime_warning_database

LOG_DEBUG = 1

def create_app_logger():
    list = helper.get_env_list()
    scheme = list["PROJECT_SCHEME"].strip("\"")
    device = list["DEVICE_ID"].strip("\"")
    platform = list["PLATFORM"].strip("\"")
    if platform == "macOS":
        device = "MAC_OS"
    app_logger = AppLogger(f".logs/app_{device}.log", scheme, "")
    return app_logger

# GLOBAL
app_logger = create_app_logger()

log_file = ".logs/lldb.log"
runtime_warning_log = ".logs/runtime_warning.log"
if LOG_DEBUG != 0:
    with open(log_file, 'w', encoding="utf-8") as file:
        file.write("")

with open(runtime_warning_log, 'w', encoding="utf-8") as file:
    file.write("")


log_mutex = threading.Lock()
def logMessage(message, file_name = log_file):
    global log_mutex
    
    if LOG_DEBUG == 0:
        return
    with log_mutex:
        with open(file_name, 'a', encoding="utf-8") as file:
            file.write(str(message) + "\n")
            file.flush()


def perform_debugger_command(debugger, command):
    if isinstance(debugger, lldb.SBTarget):
        debugger = debugger.GetDebugger()
    logMessage("Debugger: " + str(debugger))
    logMessage("Command: " + str(command))
    try:
        interpreter = debugger.GetCommandInterpreter()
        returnObject = lldb.SBCommandReturnObject()
        interpreter.HandleCommand(command, returnObject)
        logMessage("Result Command: " + str(returnObject))
    except Exception as e:
        logMessage("Error executing command:" + str(e))


script_path = None

def kill_codelldb(debugger):
    global script_path
    perform_debugger_command(debugger, f"target create {script_path}/lldb_exe_stub")
    process = subprocess.Popen(f"{script_path}/lldb_exe_stub")
    perform_debugger_command(debugger, f"process attach --pid {process.pid}")


def wait_for_exit(debugger, start_time, session_id):
    logMessage("Waiting for exit")
    
    while True:
        if not helper.is_debug_session_valid(session_id, start_time):
            perform_debugger_command(debugger, "process detach")
            return
        time.sleep(0.5)


runtime_warning_process: subprocess.Popen = None
def create_apple_runtime_warning_watch_process(debugger, pid):
    global runtime_warning_process
    try: 
        env_list = helper.get_env_list()
        device_id = env_list["DEVICE_ID"].strip("\n")
        
        if env_list["PLATFORM"].strip("\"") == "macOS":
            logMessage("Runtime warnings are not supported for MacOS apps")
            return
        
        command = f"xcrun simctl spawn {device_id} log stream --level debug --style syslog --color none --predicate 'subsystem CONTAINS \"com.apple.runtime-issues\" AND processIdentifier == {pid}'"
        logMessage(f"Watching runtime warning command: {command}")

        runtime_warning_process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        flags = fcntl.fcntl(runtime_warning_process.stdout, fcntl.F_GETFL) # first get current process.stdout flags
        fcntl.fcntl(runtime_warning_process.stdout, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    except Exception as e:
        logMessage(f"Error on watching {e}")


def print_app_log(debugger, pid):
    global app_logger
    logMessage("Waiting for logs")
        
    try:
        app_logger.watch_app_log()
    except Exception as e:
        print(f"Printer crashed: {str(e)}")

is_process_watching = False 

def wait_for_process(process_name, debugger, existing_pids, start_time, session_id):
    global is_process_watching
    logMessage("Start time:" + str(start_time))
    try:
        logMessage(f"Waiting for process: {process_name}")
        logMessage(f"Session_id: {session_id}") 
        while True:
            if not helper.is_debug_session_valid(session_id, start_time):
                kill_codelldb(debugger)
                return

            new_list = helper.get_list_of_pids(process_name)
            new_list = [x for x in new_list if not x in existing_pids]

            if len(new_list) > 0:
                threading.Thread(target=wait_for_exit, args=(debugger, start_time, session_id)).start()
                is_process_watching = True
                
                pid = new_list.pop()
                logMessage(f"Attaching to pid: {pid}")
                attach_command = f"process attach --pid {pid}"
                perform_debugger_command(debugger, attach_command)
                
                threading.Thread(target=print_app_log, args=(debugger, pid)).start()
                create_apple_runtime_warning_watch_process(debugger, pid)
                                
                return

            time.sleep(0.01)
    except Exception as e:
        logMessage(str(e))

start_time = time.time()


def watch_new_process(debugger, command, result, internal_dict):
    logMessage("Debugger: " + str(debugger))
    global existing_pids
    global start_time

    logMessage(f"Watching command: {command}")
    commands = command.split(" ")

    session_id = commands[0]
    if not helper.is_debug_session_valid(session_id, start_time):
        kill_codelldb(debugger)
        return

    process_name = helper.get_process_name()
    existing_pids = helper.get_list_of_pids(process_name)
    helper.update_debugger_launch_config(session_id, "status", "launched")
    wait_for_process(process_name, debugger, existing_pids, start_time, session_id)
    env_list = helper.get_env_list()
    device_id = env_list["DEVICE_ID"].strip("\n")
    perform_debugger_command(debugger,f"simulator-focus-monitor {device_id}")


def setScriptPath(debugger, command, result, internal_dict):
    global script_path
    logMessage("Set Script Path to: " + str(command))
    script_path = command


mutex_log_runtime_error = threading.Lock()
def logRuntimeError(deb, json):
    global mutex_log_runtime_error
    global runtime_warning_process
    if not runtime_warning_process:
        return

    with mutex_log_runtime_error:
        last_line = None
        while True:
            try:
                input = runtime_warning_process.stdout.readline()
                if not input:
                    if not last_line:
                        continue
                    if last_line.find("[com.apple.runtime-issues") == -1:
                        continue

                    break
                last_line = input
                if last_line.find("[com.apple.runtime-issues") != -1:
                    break
                # logMessage(input)
            except:
                if not last_line or last_line.find("[com.apple.runtime-issues") == -1:
                    continue
                break
        try:
            runtime_warning_database.store_runtime_warning(last_line, json)
            logMessage(last_line)
            # logMessage(json)
        except Exception as e: 
            logMessage(f"Error logging to runtime database: {str(e)}")


def printRuntimeWarning(debugger, command, result, internal_dict):
    if isinstance(debugger, lldb.SBTarget):
        debugger = debugger.GetDebugger()
    try:
        target: lldb.SBTarget = debugger.GetSelectedTarget()
        process: lldb.SBProcess = target.GetProcess()
        thread: lldb.SBThread = process.GetSelectedThread()
        frame: lldb.SBFrame = thread.GetSelectedFrame()

        def bt_to_json(frame: lldb.SBFrame):
            thread: lldb.SBThread = frame.GetThread()
            frames = []
            for frame in thread:
                lineEntry: lldb.SBLineEntry = frame.GetLineEntry()
                fileSpec: lldb.SBFileSpec = lineEntry.GetFileSpec()
                frame_info = frozenset({
                    "index": frame.idx,
                    "function": frame.GetFunctionName(),
                    "file": fileSpec.fullpath,
                    "line": lineEntry.GetLine(),
                    "column": lineEntry.GetColumn()
                }.items())
                frames.append(frame_info)
            return frames

        frame = bt_to_json(frame)
        threading.Thread(target=logRuntimeError, args=(debugger, frame)).start()
        
    except Exception as e:
        logMessage("---------------Runtime warning error:\n" + str(e), file_name=runtime_warning_log)
    logMessage("Logged runtime warning")


def wait_until_build(debugger, session_id):
    while True:
        if not helper.is_debug_session_valid(session_id, start_time):
            kill_codelldb(debugger)
            return "stopped"
        status = helper.get_debugger_launch_config(session_id, "status")
        if status == "launching" or status == "launched":
            return status
        time.sleep(0.3) 


def create_target(debugger, command, result, internal_dict):
    try:
        global app_logger
        session_id = command
        status = wait_until_build(debugger, session_id)
        if status == "stopped":
            return
        
        app_logger.session_id = session_id
        logMessage(f"Creating Session with session id: {session_id}")
        result.AppendMessage("Start lldb watching new instance of App")
        
        list = helper.get_env_list()
        result.AppendMessage(f"Environment: {list}")

        executable = helper.get_target_executable()
        logMessage(f"Exe: {executable}")
        result.AppendMessage(f"Creating {executable}")
        perform_debugger_command(debugger, f"target create \"{executable}\"")
        result.AppendMessage(str(debugger.GetSelectedTarget()))
        result.AppendMessage(f"Target created for {executable}")
        # Set common breakpoints, so if tests are running with debugger, so it's caught
        # deprecated
        # breakpoint on test failed
        #perform_debugger_command(debugger, "breakpoint set --selector recordFailureWithDescription:inFile:atLine:expected:")
        #perform_debugger_command(debugger, "breakpoint set --name _XCTFailureHandler")
        # breakpoint on runtime warning
        # perform_debugger_command(debugger, "breakpoint set --name os_log_fault_default_callback")
        # catch the runtime crash
        perform_debugger_command(debugger, "breakpoint set --name __exceptionPreprocess")
        
        
    except Exception as e:
        logMessage(str(e))


def app_log(debugger, command, result, internal_dict):
    global app_logger
    if command == "on":
        app_logger.enabled = True
        result.AppendMessage("App Logger Turned On")
    elif command == "off":
        app_logger.enabled = False
        result.AppendMessage("App Logger Turned Off")
    else:
        result.AppendMessage("Valid value of app_log command is <on/off>")

def terminate_debugger(debugger, command, result, internal_dict):
    perform_debugger_command(debugger, "process detach")

# ---------------------------FOCUS-SIMULATOR

current_focus_time = time.time()
def start_monitor(debugger, command, exe_ctx, result, internal_dict):
    "Start monitor to manage simulator window focus while debugging. (Usage: simulator-focus-monitor Simulator)"
    process = exe_ctx.GetProcess()
    list = helper.get_env_list()
    product_name = helper.get_product_name()

    def focus_simulator(udid):
        nonlocal list
        nonlocal product_name
        global is_process_watching
        if not is_process_watching:
            return
        platform = list["PLATFORM"].strip("\"")
        if (platform == "macOS"):
            logMessage(f"UDID: {platform}")
            subprocess.run(["osascript", "-e", f"tell application \"{product_name}\" to activate"])
        else:
            logMessage(f"UDID: {udid}")
            subprocess.run(['open', '-a', 'Simulator', '--args', '-CurrentDeviceUDID', udid])

    # Focus simulator if the process is currently running
    if (process.GetState() == lldb.eStateRunning):
        focus_simulator(command)

    def focus_simulator_launcher(process, command, start_time):
        global current_focus_time
        try:
            # logMessage(f"Focus start: {command}, {start_time}, {current_time}")
            # wait for 1 second to make sure that a user is actually run the app, not stepping over the code
            time.sleep(1)
            if current_focus_time == start_time and process.GetState() == lldb.eStateRunning:
                focus_simulator(command)
        except Exception as e:
            logMessage(f"Focus failed: {str(e)}")
            
    # Method to wait for state changes
    def listen_process_events():
        global current_focus_time
        try: 
            prevState = None
            while True:
                process = debugger.GetSelectedTarget().GetProcess()
                if prevState != process.GetState():
                    prevState = process.GetState()
                    current_focus_time = time.time();
                    if (process.GetState() == lldb.eStateRunning):
                        focus_thread = threading.Thread(target=focus_simulator_launcher, args=( process, command, current_focus_time ))
                        focus_thread.start()
                time.sleep(0.1)
        except Exception as e:
            logMessage(f"LISTENER_ERROR {str(e)}")

    event_listener = threading.Thread(target=listen_process_events)
    event_listener.daemon = True
    event_listener.start()