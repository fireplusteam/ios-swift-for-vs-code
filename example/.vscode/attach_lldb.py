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
        file.write(message + "\n")


def performDebuggerCommand(debugger, command):
    interpreter = debugger.GetCommandInterpreter()
    returnObject = lldb.SBCommandReturnObject()
    interpreter.HandleCommand(command, returnObject)
    logMessage(str(returnObject)) 


# workaround, killing debugservers causing that process to be killed to, so we can re-launch vs code debug session
def kill_process():
    try:
        subprocess.run(["killall", "-9", "debugserver"])
    except Exception as e:
        logMessage(str(e))


def wait_for_exit():
    while True:
        with open(".logs/lldb_exit.changed", 'r') as file:
            config = json.load(file)

        if config is not None and "session_end_time" in config:
            time = config["session_end_time"]
            #TODO: 
            kill_process()

        time.sleep(1)


def wait_for_process(process_name, debugger, existing_pids):
    try:
        while True:
            new_list = get_list_of_pids(process_name)
            new_list = [x for x in new_list if not x in existing_pids]

            logMessage(str(new_list) + str(existing_pids))

            if len(new_list) > 0:
                pid = new_list.pop()
                attach_command = f"process attach --pid {pid}"
                performDebuggerCommand(debugger, attach_command)
                performDebuggerCommand(debugger, "continue")

                thread = threading.Thread(target=wait_for_exit, args=())
                thread.start()
                return

            time.sleep(1)
    except Exception as e:
        logMessage(str(e))


def attach_next_proccess(debugger, command, result, internal_dict):
    result.AppendMessage("Start lldb watching new instance of App")

    list = helper.get_env_list()

    result.AppendMessage("Enviroment:" + str(list))

    process_name = list["PROJECT_SCHEME"].strip("\"")
    process_name = f"{process_name}.app/{process_name}"
    existing_pids = get_list_of_pids(process_name)
    
    logMessage(str(existing_pids))

    result.AppendMessage("Hello from my custom command!_next")

    thread = threading.Thread(target=wait_for_process, args=(process_name, debugger, existing_pids))   
    thread.start()
