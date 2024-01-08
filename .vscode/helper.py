import subprocess
import sys
import json
import os

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


def get_bundle_identifier(project_file, scheme):
    command = ["xcodebuild", "-showBuildSettings", "-workspace", project_file, "-scheme", scheme]
    process = subprocess.run(command, capture_output=True, text=True)
    for line in process.stdout.splitlines():
        line = line.strip()
        if "BUNDLE_IDENTIFIER" in line:
            return line.split("=")[1].strip()
    
    return None


def update_scheme(project_file, scheme):
    env_list = get_env_list()
    env_list["PROJECT_SCHEME"] = "\"" + scheme + "\""
    env_list["BUNDLE_APP_NAME"] = "\"" + get_bundle_identifier(project_file, scheme) + "\""
    safe_env_list(env_list)


def update_project_file(project_file):
    env_list = get_env_list()
    env_list["PROJECT_FILE"] = "\"" + project_file + "\""
    safe_env_list(env_list)
    # update schemes
    schemes = get_schemes(project_file)
    update_scheme(project_file, schemes[0])

def is_build_server_valid():
    env_list = get_env_list()
    json_file_path = "buildServer.json"
    if not os.path.exists(json_file_path):
        return False

    with open(json_file_path, 'r') as file:
        build_server = json.load(file)
    
    print("BuildServer: ", build_server, "\nENV_FILE:", env_list)

    if not (env_list["PROJECT_FILE"].strip("\"") in build_server["workspace"]):
        return False

    if build_server["scheme"] != env_list["PROJECT_SCHEME"].strip("\""):
        return False

    return True

if __name__ == "__main__":
    print("ok")