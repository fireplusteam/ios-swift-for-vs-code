import subprocess
import sys
import os
import asyncio
import json

device_uuid = sys.argv[1]
bundle = sys.argv[2]
print("INPUT", device_uuid, bundle)

commandLaunch = ["xcrun", "simctl", "launch", "--console-pty", device_uuid, bundle]
commandPID = ["xcrun", "simctl", "spawn", device_uuid, "launchctl", "list"]    
cwd = os.getcwd()

async def get_app_pid():
    try:
        result = subprocess.run(commandPID, stdout=subprocess.PIPE, text=True, timeout=5)
        output = result.stdout.splitlines()
        #xcrun returns each line in the following format
        #29474	0	UIKitApplication:puzzle.TestVSCode[2b19][rb-legacy]
        if output:
            line = [line for line in output if bundle in line]
            if line.count == 0:
                print("${bundle} is not running")
                return None
            pid_str = line[0].split()[0]
            return int(pid_str)
        else:
            print("xcrun doensnt exist")
            return None
    except subprocess.TimeoutExpired:
        print("Timeout of running process") 
        return None

async def updateSetting(pid: int):
    file_path = '.vscode/settings.json'
    with open(file_path, 'r') as file:
        settings = json.load(file)
    
    settings['iOS_PID'] = pid
    with open(file_path, 'w') as file:
        json.dump(settings, file, indent=2)

async def run_command(command):
    # Start the subprocess
    
    process = await asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=cwd, text=False)
    print(process)

    await asyncio.sleep(2)
    pid = await get_app_pid()
    print(f"iOS APP PID: {pid}")
    await updateSetting(pid=pid)

    # Read stdout and stderr concurrently
    stdout, stderr = await asyncio.gather(
        read_stream(process.stdout),
        read_stream(process.stderr)
    )

    # Wait for the process to complete
    return await process.wait(), stdout, stderr

async def read_stream(stream):
    output = ""
    while True:
        line = await stream.readline()
        if not line:
            break
        #output += line.decode("utf-8")
        print(line.decode("utf-8"))
    return output

async def main():
    # Set your command

    # Run the command asynchronously
    return_code, stdout_output, stderr_output = await run_command(commandLaunch)

    # Print or process the output as needed
    print("=== Return Code ===")
    print(return_code)

    print("\n=== Standard Output ===")
    print(stdout_output)

    print("\n=== Standard Error ===")
    print(stderr_output)

# Run the event loop
asyncio.run(main())
