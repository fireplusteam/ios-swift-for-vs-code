import sys
import os
import helper
import subprocess

script = os.getenv("VS_IOS_SCRIPT_PATH")
    

def update_environment(project_file):
    schemes = helper.get_schemes(project_file)
    env_file = helper.get_env_list()
    _ = env_file["PROJECT_CONFIGURATION"] # trigger an error in case if configuration is not set
    _ = env_file["PLATFORM"] # trigger an error in case if configuration is not set
    try: 
        if not (env_file["PROJECT_SCHEME"].strip("\"") in schemes):
            helper.update_scheme(project_file, schemes[0])
    except KeyError:
        helper.update_scheme(project_file, schemes[0])

def bind_autocomplete():
    if not helper.is_build_server_valid():
        print("RESTARTING XCODE BUILD SERVER")
        print(script)
        process = subprocess.run(f"{script}/build_autocomplete.sh", shell=True, capture_output=True)
        print(process.stdout.decode("utf-8"))
        print(process.stderr.decode("utf-8"))
        return True
    return False


if __name__ == "__main__":
    
    project_file = sys.argv[1]
    print(f"ENV_FILE: {script}", file=sys.stderr)
    
    os.makedirs('.logs', exist_ok=True)
    if os.path.exists(project_file):
        print("valid project file")
        update_environment(project_file)
    else:
        print(f"{project_file} is not valid")
        cwd = os.getcwd()
        files = os.listdir(cwd)
        is_workspace = False
        for file in files:
            if ".xcworkspace" in file:
                is_workspace = True
                helper.update_project_file(file)
                project_file = file
        print("Workspace existence: ", is_workspace)
        if not is_workspace:
            print(files, cwd)
            is_project = False
            for file in files:
                if ".xcodeproj" in file:
                    helper.update_project_file(file) 
                    print(file)
                    project_file = file
                    is_project = True
                    
            if not is_project:
                for file in files:
                    if "Package.swift" in file:
                        helper.update_project_file(file)
                        print(file)
                        project_file = file
                
        update_environment(project_file) 

    print("UPDATE BINDING")
    # validate build server
    helper.update_git_exclude("buildServer.json")
    helper.update_git_exclude(".logs")
    helper.update_git_exclude(".vscode")
    if bind_autocomplete():
        print("Restarting LSP")
        

    