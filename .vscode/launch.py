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
        while True:
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
                    continue
                pid_str = line[0].split()
                if len(pid_str) == 0:
                    continue
                pid_str = pid_str[0]
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


async def install_app(command, log_file):
    # Start the subprocess
    
    process = await asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=cwd, text=False)
    print(process)

    await asyncio.sleep(1)
    pid = await get_app_pid()
    print("iOS App Running")
    print("iOS App log: .vscode/app.log")
    print(f"iOS APP PID: {pid}")
    await updateSetting(pid=pid)
    # Read stdout and stderr concurrently
    stdout, stderr = await asyncio.gather(
        read_stream(process.stdout, log_file),
        read_stream(process.stderr, log_file)
    )

    # Wait for the process to complete
    return await process.wait(), stdout, stderr


async def read_stream(stream, log_file):
    while True:
        line = await stream.readline()
        if not line:
            break
        log_file.write(line.decode("utf-8"))
        log_file.flush()
    return None


async def main():
    # Run the command asynchronously
    with open(".vscode/app.log", 'w') as log_file:
        return_code, stdout_output, stderr_output = await install_app(commandLaunch, log_file)

        # Print or process the output as needed
        print(f"iOS App Finished with {return_code}")


# Run the event loop
asyncio.run(main())
