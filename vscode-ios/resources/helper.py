import subprocess
import json
import os
import time
import sys

#-----------------------ARGS

def get_arg_value_by_name(name: str):
    for i, arg in enumerate(sys.argv):
        if arg == name:
            return sys.argv[i + 1]


#-----------------------FILE_LOCK
file_path = '.vscode/.env'

class FileLock:
    def __init__(self, file_name):
        self.lock_file = f"{file_name}.lock"

    def __enter__(self):
        while True:
            try:
                # If the lock file can be created, it means there's no other one existing
                self.fd = os.open(self.lock_file, os.O_CREAT | os.O_EXCL | os.O_RDWR)
                break;
            except FileExistsError:
                # If the creation fails because the file already exists the file is locked by another process
                time.sleep(0.1)

    def __exit__(self, exc_type, exc_val, exc_tb):
        os.close(self.fd)
        os.remove(self.lock_file)


def get_env_list():
    dict = {}
    with FileLock(file_path + '.lock'):
        with open(file_path, 'r') as file:
            for line in file:
                pos = line.strip().find("=")
                dict[line.strip()[:pos]] =  line.strip()[pos + 1:]
    return dict


def safe_env_list(list):
    with FileLock(file_path + '.lock'):
        with open(file_path, 'w') as file:
            for key, value in list.items():
                file.write(key + "=" + value + "\n")


def get_project_type(project_file):
    if ".xcodeproj" in project_file:
        return "-project"
    if "Package.swift" in project_file:
        return "-package"
    return "-workspace"


def get_schemes(project_file):
    
    command = ["xcodebuild", "-list"]
    scheme_type = get_project_type(project_file)
    if "-package" != scheme_type:
        command.extend([get_project_type(project_file), project_file])
    process = subprocess.run(command, capture_output=True, text=True)
    schemes = []
    is_tail = False
    for x in process.stdout.splitlines():
        if is_tail and len(x) > 0:
            schemes.append(x.strip())
        if "Schemes:" in x:
            is_tail = True
    
    return schemes


def get_project_settings(project_file, scheme):
    command = ["xcodebuild", "-showBuildSettings", get_project_type(project_file), project_file, "-scheme", scheme, "-configuration", "Debug"]
    process = subprocess.run(command, capture_output=True, text=True)
    return process.stdout


def get_bundle_identifier(project_file, scheme):
    stdout = get_project_settings(project_file, scheme)
    for line in stdout.splitlines():
        line = line.strip()
        if "BUNDLE_IDENTIFIER" in line:
            return line.split("=")[1].strip()
    
    return None


def get_product_name_imp(project_file, scheme):
    stdout = get_project_settings(project_file, scheme)
    #print("Out: " + stdout)
    for line in stdout.splitlines():
        line = line.strip()
        if "PRODUCT_NAME" in line:
            return line.split("=")[1].strip()
    
    return None


def update_scheme(project_file, scheme):
    env_list = get_env_list()
    env_list["PROJECT_SCHEME"] = "\"" + scheme + "\""
    identifier = get_bundle_identifier(project_file, scheme)
    if identifier is None:
        identifier = ""
    env_list["BUNDLE_APP_NAME"] = "\"" + identifier + "\""
    safe_env_list(env_list)


def get_target_executable_impl(build_path, product_name):
   return f"{build_path}/Build/Products/Debug-iphonesimulator/{product_name}.app"


def get_project_config():
    file_path = 'buildServer.json'
    with open(file_path, 'r') as file:
       config = json.load(file)
    return config


def get_derived_data_path():
    config = get_project_config()
    return config["build_root"]


def get_target_executable():
    list = get_env_list()
    if get_project_type(list["PROJECT_FILE"]) == "-package":
        return "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/Library/Xcode/Agents/xctest"
    product_name = get_product_name() 
    config = get_project_config()
    build_root = config["build_root"]
    return get_target_executable_impl(build_path=build_root, product_name=product_name)


def get_product_name():
    list = get_env_list()
    if get_project_type(list["PROJECT_FILE"]) == "-package":
        return "xctest"
    
    config = get_project_config()
    scheme = config["scheme"]
    return get_product_name_imp(list["PROJECT_FILE"].strip("\""), scheme).removesuffix(".app")


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

# --------GIT-------------------------------------

def update_git_exlude(file_to_exclude):
    if not os.path.exists(".git"):
        return
    os.makedirs(".git/info", exist_ok=True)
    content = None
    try:
        
        with open(".git/info/exclude", 'r') as file:
            content = file.readlines()
    except: pass
    #print(f"Updating git ignore: {content}")
    if content is None:
        content = []
    if len([x for x in content if f"{file_to_exclude}".strip() == x.strip()]) == 0:
        content.insert(0, f"{file_to_exclude}\n")
        #print(f"CHANGED: {content}")
        try:
            with open(".git/info/exclude", "w+") as file:
                file.write(''.join(content))   
        except Exception as e:
            print(f"Git ignore update exception: {str(e)}")


#---------DEBUGGER--------------------------------
debugger_config_file = ".logs/debugger.launching"
def wait_debugger_to_launch():
    while True:
        with FileLock(debugger_config_file + '.lock'):
            with open(debugger_config_file, 'r') as file:
                config = json.load(file)

        if config is not None and config["status"] == "launched":
            break

        time.sleep(1)

def is_debug_session_valid(start_time) -> bool:
    try:
        with FileLock(debugger_config_file + '.lock'):
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
        with FileLock(debugger_config_file + '.lock'):
            with open(debugger_config_file, "r+") as file:
                config = json.load(file)
    
    config[key] = value
    
    with FileLock(debugger_config_file + '.lock'):
        with open(debugger_config_file, "w+") as file:
            json.dump(config, file, indent=2)

if __name__ == "__main__":
    print("ok")