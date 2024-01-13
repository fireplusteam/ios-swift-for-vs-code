import subprocess
import json
import os
import time
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

def get_project_type(project_file):
    if ".xcodeproj" in project_file:
        return "-project"
    return "-workspace"

def get_schemes(project_file):
    command = ["xcodebuild", "-list", get_project_type(project_file), project_file]
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
    command = ["xcodebuild", "-showBuildSettings", get_project_type(project_file), project_file, "-scheme", scheme, "-configuration", "Debug"]
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

def get_target_executable_impl(build_path, target):
   return f"{build_path}/Build/Products/Debug-iphonesimulator/{target}.app"


def get_target_executable():
    file_path = 'buildServer.json'

    with open(file_path, 'r') as file:
        config = json.load(file)

    build_root = config["build_root"]
    scheme = config["scheme"]

    return get_target_executable_impl(build_path=build_root, target=scheme)


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

#-----------------------------------------
debugger_config_file = ".logs/debugger.launching"
def wait_debugger_to_launch():
    while True:
        with open(debugger_config_file, 'r') as file:
            config = json.load(file)

        if config is not None and config["status"] == "launched":
            break

        time.sleep(1)

def is_debug_session_valid(start_time) -> bool:
    try:
        with open(debugger_config_file, 'r') as file:
            config = json.load(file)
        if config["sessionEndTime"] >= start_time:
            return False
        return True
    except: # no file or a key, so the session is valid
        return True
    
def update_debug_session_time():
    update_debugger_launch_config("sessionEndTime", time.time())

def update_debugger_launch_config(key, value):
    config = {}
    if os.path.exists(debugger_config_file):
        with open(debugger_config_file, "r+") as file:
            config = json.load(file)
    
    config[key] = value
    
    with open(debugger_config_file, "w+") as file:
        json.dump(config, file, indent=2)

if __name__ == "__main__":
    print("ok")