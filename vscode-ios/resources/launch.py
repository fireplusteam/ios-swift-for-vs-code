import fcntl
import subprocess
import sys
import os
import asyncio
import helper
import time
import threading

device_uuid = sys.argv[1]
bundle = sys.argv[2]
debugger_arg = sys.argv[3]
session_id = sys.argv[4]

print("INPUT", device_uuid, bundle, session_id)

commandLaunch = ["xcrun", "simctl", "launch", "--console-pty", device_uuid, bundle]
# this parameter is causing freeze if it debugger is not launched on time
#if debugger_arg == "LLDB_DEBUG":
#    commandLaunch.append("--wait-for-debugger")
    
cwd = os.getcwd()

start_time = time.time()

process = None

def session_validation():
    while True:
        global process
        if not helper.is_debug_session_valid(session_id, start_time):
            print("Should BE TERMINATED")
            try:
                process.kill()
            except: pass
            finally:
                exit()
        else: 
            print("RUNNING")
            
        time.sleep(1)


def run_process(command: str, log_file_path):
    global process
    process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    threading.Thread(target=session_validation, args=()).start()
    # Set output to non-blocking
    flags = fcntl.fcntl(process.stdout, fcntl.F_GETFL) # first get current process.stdout flags
    fcntl.fcntl(process.stdout, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    is_ok = False 
    index = 0
    while True:
        try:
            output = process.stdout.buffer.read()
        except OSError:
            time.sleep(0.1) # wait a short period of time then try again
            continue
        
        if output == b'' and process.poll() is not None:
            break
        if output:
            is_ok = True
            with helper.FileLock(log_file_path + ".lock"):
                with open(log_file_path, "a+") as file:
                    file.buffer.write(output)
                    file.flush()
        else:
            index += 1
            if index > 20:
                time.sleep(0.1)
                index = 0
                
    return process,is_ok


def main():
    # Run the command asynchronously
    return_code, is_ok = run_process(' '.join(commandLaunch), ".logs/app.log")
    helper.update_debug_session_time(session_id)

    # Print or process the output as needed
    print(f"LAUNCHER: iOS App Finished with {return_code}")

main()