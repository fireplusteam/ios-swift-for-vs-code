import subprocess
import sys
import os
import asyncio
import json
import helper
import time
import threading

device_uuid = sys.argv[1]
bundle = sys.argv[2]
debugger_arg = sys.argv[3]
print("INPUT", device_uuid, bundle)

commandLaunch = ["xcrun", "simctl", "launch", "--console-pty", device_uuid, bundle]
if debugger_arg == "LLDB_DEBUG":
    commandLaunch.append("--wait-for-debugger")
    
cwd = os.getcwd()

start_time = time.time()

def session_validation(process: asyncio.subprocess.Process):
    while True:
        if not helper.is_debug_session_valid(start_time):
            try:
                process.kill()
            except: pass
            finally:
                exit()
                
        time.sleep(1)


async def install_app(command, log_file_path):
    # wait for debugger
    if debugger_arg == "LLDB_DEBUG":
        helper.wait_debugger_to_launch()

    # Start the subprocess
    process = await asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=cwd, text=False)
    
    threading.Thread(target=session_validation, args=(process)).start()

    await asyncio.sleep(1)
    # Read stdout and stderr concurrently
    stdout, stderr = await asyncio.gather(
        read_stream(process.stdout, log_file_path),
        read_stream(process.stderr, log_file_path)
    )

    # Wait for the process to complete
    return await process.wait(), stdout, stderr


async def read_stream(stream, log_file_path):
    while True:
        line = await stream.readline()
        if not line:
            break
        try:
            with helper.FileLock(log_file_path + ".lock"):
                with open(log_file_path, "a+") as file:
                    file.write(line.decode("utf-8"))
                    file.flush()
        except Exception as e:
            pass
    return None


async def main():
    if debugger_arg == "LLDB_DEBUG":
        helper.update_debugger_launch_config("status", "launching")
        
    # Run the command asynchronously
    return_code, stdout_output, stderr_output = await install_app(commandLaunch, ".logs/app.log")

    # Print or process the output as needed
    print(f"iOS App Finished with {return_code}")


# Run the event loop
asyncio.run(main())
