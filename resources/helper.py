#!/usr/bin/env python3
import subprocess
import json
import os
import time
import fileLock

def get_list_of_pids(process_name: str):
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


# --------GIT-------------------------------------

def update_git_exclude(file_to_exclude):
    if not os.path.exists(".git"):
        return
    os.makedirs(".git/info", exist_ok=True)
    content = None
    try:
        with open(".git/info/exclude", 'r') as file:
            content = file.readlines()
    except: pass
    #print(f"Updating git ignore: {content}")
    if content is None:
        content = []
    if len([x for x in content if f"{file_to_exclude}".strip() == x.strip()]) == 0:
        content.insert(0, f"{file_to_exclude}\n")
        #print(f"CHANGED: {content}")
        try:
            with open(".git/info/exclude", "w+") as file:
                file.write(''.join(content))   
        except Exception as e:
            print(f"Git ignore update exception: {str(e)}")


#---------DEBUGGER--------------------------------
debugger_config_file = ".vscode/xcode/debugger.launching"
def wait_debugger_to_action(session_id, actions: list[str]):
    while True:
        with fileLock.FileLock(debugger_config_file):
            with open(debugger_config_file, 'r') as file:
                config = json.load(file)
        if config is not None and not session_id in config:
            break
            
        if config is not None and config[session_id]["status"] in actions:
            break
        
        time.sleep(1)


def is_debug_session_valid(session_id) -> bool:
    try:
        with fileLock.FileLock(debugger_config_file):
            with open(debugger_config_file, 'r') as file:
                config = json.load(file)
            if not session_id in config:
                return False
            if config[session_id]["status"] == "stopped":
                return False

            return True
    except: # no file or a key, so the session is valid
        return True
    

def get_debugger_launch_config(session_id, key):
    with fileLock.FileLock(debugger_config_file):
        with open(debugger_config_file, 'r') as file:
            config = json.load(file)
            if config is not None and not session_id in config:
                return None
            
            if config is not None and config[session_id][key]:
                return config[session_id][key]


def update_debugger_launch_config(session_id, key, value):
    config = {}
    try:
        with fileLock.FileLock(debugger_config_file):
            if os.path.exists(debugger_config_file):
                try: 
                    with open(debugger_config_file, "r+") as file:
                        config = json.load(file)
                except:
                    pass

            if session_id in config:
                # stopped can not be updated once reported
                if key == "status" and key in config[session_id] and config[session_id][key] == 'stopped':
                    return
                config[session_id][key] = value;
            else:
                config[session_id] = {}
                config[session_id][key] = value

            with open(debugger_config_file, "w+") as file:
                json.dump(config, file, indent=2)
    except:
        pass # config is empty


if __name__ == "__main__":
    print("ok")

#---------------------BINARY READER HELPER----------------------------

def binary_readline(file, newline=b'\r\n'):
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