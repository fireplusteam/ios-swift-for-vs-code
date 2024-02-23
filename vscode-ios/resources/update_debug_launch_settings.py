import subprocess
import sys
import os
import asyncio
import json
import time
import helper

device_uuid = sys.argv[1]
bundle = sys.argv[2]
session_id = sys.argv[3]
print("INPUT", device_uuid, bundle)

commandPID = ["xcrun", "simctl", "spawn", device_uuid, "launchctl", "list"]    
cwd = os.getcwd()

start_time = time.time()

async def get_app_pid():
    try:
        number_of_tries = 0
        while number_of_tries < 20:
            if not helper.is_debug_session_valid(session_id, start_time):
                return
            number_of_tries += 1
            result = subprocess.run(commandPID, stdout=subprocess.PIPE, text=True, timeout=10)
            output = result.stdout.splitlines()
            #xcrun returns each line in the following format
            #29474	0	UIKitApplication:puzzle.TestVSCode[2b19][rb-legacy]
            if output:
                line = [line for line in output if bundle in line]
                                
                if line.count == 0:
                    print("${bundle} is not running")
                    return None
                if len(line) == 0:
                    await asyncio.sleep(3)
                    continue
                pid_str = line[0].split()
                if len(pid_str) == 0:
                    await asyncio.sleep(3)
                    continue
                pid_str = pid_str[0]
                return int(pid_str)
            else:
                print("xcrun doesn't exist")
                return None
    except subprocess.TimeoutExpired:
        print("Timeout of running process")
        return None


async def main():
    pid = await get_app_pid()
    print("iOS App Running")
    print("iOS App log: .logs/app.log")
    print(f"iOS APP PID: {pid}")
    if pid is None: 
        pid = 0


# Run the event loop
asyncio.run(main())
