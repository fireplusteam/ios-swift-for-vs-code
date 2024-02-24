import sys
import os
import subprocess

command = ["python3"]
#command = ["nohup", "python3"]
for i, arg in enumerate(sys.argv):
    if i > 0:
        command.append(arg)

print(command)

process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, preexec_fn=os.setpgrp)


os._exit(0)