import lldb
import time
import subprocess
import helper
import threading
import sys
import json

def get_list_of_pids(process_name):
    proc = subprocess.run(["ps", "aux"], capture_output=True, text=True)

    # Split the output into lines
    lines = proc.stdout.split('\n')

    # get list of pids by process name
    result = set()
    for line in lines[1:]:  # Skip the header line
        columns = line.split()
        if len(columns) >= 2 and process_name in columns[10]:
            pid = columns[1]
            process_name = columns[10]
            logMessage(pid + " " + process_name)
            result.add(pid)

    return result


log_file = ".logs/lldb.log"
with open(log_file, 'w') as file:
    file.write("")


def logMessage(message):
    with open(log_file, 'a') as file:
        file.write(str(message) + "\n")


def perform_debugger_command(debugger, command):
    logMessage("Debugger: " + str(debugger))
    logMessage("Command: " + str(command))
    try:
        interpreter = debugger.GetCommandInterpreter()
        returnObject = lldb.SBCommandReturnObject()
        interpreter.HandleCommand(command, returnObject)
        logMessage("Result Command: " + str(returnObject))
    except Exception as e:
        logMessage("Error executing command:" + str(e))


def wait_for_process(process_name, debugger, existing_pids):
    try:
        while True:
            new_list = get_list_of_pids(process_name)
            new_list = [x for x in new_list if not x in existing_pids]

            logMessage(str(new_list) + str(existing_pids))

            if len(new_list) > 0:
                pid = new_list.pop()
                attach_command = f"process attach --pid {pid}"
                perform_debugger_command(debugger, attach_command)
                perform_debugger_command(debugger, "continue")
                return

            time.sleep(1)
    except Exception as e:
        logMessage(str(e))


def watch_new_process(debugger, command, result, internal_dict):
    logMessage("Debugger: " + str(debugger))
    global existing_pids

    list = helper.get_env_list()
    process_name = list["PROJECT_SCHEME"].strip("\"")
    process_name = f"{process_name}.app/{process_name}"

    thread = threading.Thread(target=wait_for_process, args=(process_name, debugger, existing_pids))   
    thread.start()


def create_target(debugger, command, result, internal_dict):
    try:
        global existing_pids
        result.AppendMessage("Start lldb watching new instance of App")
        
        list = helper.get_env_list()
        result.AppendMessage(f"Enviroment: {list}")

        process_name = list["PROJECT_SCHEME"].strip("\"")
        process_name = f"{process_name}.app/{process_name}"
        existing_pids = get_list_of_pids(process_name)


        executable = helper.get_target_executable()
        result.AppendMessage(f"Creating {executable}")
        perform_debugger_command(debugger, f"target create \"{executable}\"")
        result.AppendMessage(str(debugger.GetSelectedTarget()))
        result.AppendMessage(f"Target created for {executable}")
        
    except Exception as e:
        logMessage(str(e))


def terminate_debugger(debugger, command, result, internal_dict):
    pass # TODO