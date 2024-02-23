#!/usr/bin/env python3
import lldb
import time
import subprocess
import helper
import threading
import sys
import json
from app_log import AppLogger

LOG_DEBUG = 1

def create_app_logger():
    list = helper.get_env_list()
    scheme = list["PROJECT_SCHEME"].strip("\"")
    app_logger = AppLogger(".logs/app.log", scheme, "")
    return app_logger

# GLOBAL
app_logger = create_app_logger()

log_file = ".logs/lldb.log"
if LOG_DEBUG != 0:
    with open(log_file, 'w') as file:
        file.write("")

def get_list_of_pids(process_name):
    proc = subprocess.run(["ps", "aux"], capture_output=True, text=True)

    #print(proc.stdout)
    
    # Split the output into lines
    lines = proc.stdout.split('\n')

    # get list of pids by process name
    result = set()
    for line in lines[1:]:  # Skip the header line
        columns = line.split()
        if len(line) == 0:
            break
        
        proc_start = line.find(columns[9]) + len(columns[9])
        proc_line = line[proc_start:].strip()
        if len(columns) >= 2 and process_name in proc_line:
            pid = columns[1]
            result.add(pid)

    return result


def logMessage(message):
    if LOG_DEBUG == 0:
        return
    with open(log_file, 'a') as file:
        file.write(str(message) + "\n")


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


def kill_codelldb(debugger):
    perform_debugger_command(debugger, "target create .vscode/lldb_exe_stub")
    perform_debugger_command(debugger, "process launch")


def wait_for_exit(debugger, start_time, session_id):
    logMessage("Waiting for exit")
    
    while True:
        if not helper.is_debug_session_valid(session_id, start_time):
            perform_debugger_command(debugger, "process detach")
            return
        time.sleep(0.5)


def print_app_log(debugger):
    global app_logger
    logMessage("Waiting for logs")
        
    try:
        app_logger.watch_app_log()
    except Exception as e:
        print(f"Printer crashed: {str(e)}")


def wait_for_process(process_name, debugger, existing_pids, start_time, session_id):
    logMessage("Start time:" + str(start_time))
    try:
        logMessage(f"Waiting for process: {process_name}")
        logMessage(f"Session_id: {session_id}") 
        while True:
            if not helper.is_debug_session_valid(session_id, start_time):
                kill_codelldb(debugger)
                return

            new_list = get_list_of_pids(process_name)
            new_list = [x for x in new_list if not x in existing_pids]

            if len(new_list) > 0:
                threading.Thread(target=wait_for_exit, args=(debugger, start_time, session_id)).start()
                
                pid = new_list.pop()
                attach_command = f"process attach --pid {pid}"
                perform_debugger_command(debugger, attach_command)
                perform_debugger_command(debugger, "continue")
                
                threading.Thread(target=print_app_log, args=(debugger)).start()
                                
                return

            time.sleep(0.05)
    except Exception as e:
        logMessage(str(e))

start_time = time.time()


def get_process_name():
    process_name = helper.get_product_name()
    if process_name == "xctest":
        return process_name
    return f"{process_name}.app/{process_name}"


def watch_new_process(debugger, command, result, internal_dict):
    logMessage("Debugger: " + str(debugger))
    global existing_pids
    
    session_id = command
    thread = threading.Thread(target=wait_for_process, args=(get_process_name(), debugger, existing_pids, start_time, session_id))   
    thread.start()
    helper.update_debugger_launch_config(session_id, "status", "launched")


def create_target(debugger, command, result, internal_dict):
    try:
        global app_logger
        session_id = command
        app_logger.session_id = session_id
        logMessage(f"Creating Session with session id: {session_id}")
        helper.update_debugger_launch_config(session_id, "status", "launching")
        global existing_pids
        result.AppendMessage("Start lldb watching new instance of App")
        
        list = helper.get_env_list()
        result.AppendMessage(f"Environment: {list}")

        process_name = get_process_name()
        existing_pids = get_list_of_pids(process_name)


        executable = helper.get_target_executable()
        logMessage(f"Exe: {executable}")
        result.AppendMessage(f"Creating {executable}")
        perform_debugger_command(debugger, f"target create \"{executable}\"")
        result.AppendMessage(str(debugger.GetSelectedTarget()))
        result.AppendMessage(f"Target created for {executable}")
        # Set common breakpoints, so if tests are running with debugger, so it's caught
        # deprecated
        #perform_debugger_command(debugger, "breakpoint set --selector recordFailureWithDescription:inFile:atLine:expected:")
        #perform_debugger_command(debugger, "breakpoint set --name _XCTFailureHandler")
        
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
