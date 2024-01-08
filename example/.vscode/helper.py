import subprocess
import sys


file_path = '.vscode/.env'


def get_env_list():
    with open(file_path, 'r') as file:
        key_value = [line.strip().split('=') for line in file]
    return dict(key_value)


def safe_env_list(list):
    with open(file_path, 'w') as file:
        for key, value in list.items():
            file.write(key + "=" + value + "\n")


def get_schemes(project_file):
    command = ["xcodebuild", "-list", "-workspace", project_file]
    process = subprocess.run(command, capture_output=True, text=True)
    schemes = []
    is_tail = False
    for x in process.stdout.splitlines():
        if is_tail and len(x) > 0:
            schemes.append(x.strip())
        if "Schemes:" in x:
            is_tail = True
    
    return schemes

if __name__ == "__main__":
    print("ok")