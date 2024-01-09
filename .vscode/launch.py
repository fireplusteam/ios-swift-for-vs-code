import subprocess
import sys
import os
import asyncio
import json

device_uuid = sys.argv[1]
bundle = sys.argv[2]
print("INPUT", device_uuid, bundle)

commandLaunch = ["xcrun", "simctl", "launch", "--console-pty", device_uuid, bundle]
cwd = os.getcwd()


async def install_app(command, log_file):
    # Start the subprocess
    
    process = await asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=cwd, text=False)
    print(process)

    await asyncio.sleep(1)
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
    with open(".logs/app.log", 'w') as log_file:
        return_code, stdout_output, stderr_output = await install_app(commandLaunch, log_file)

        # Print or process the output as needed
        print(f"iOS App Finished with {return_code}")


# Run the event loop
asyncio.run(main())
