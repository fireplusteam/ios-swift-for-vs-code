import sys
import os
import helper
import subprocess


def update_enviroment(project_file):
    schemes = helper.get_schemes(project_file)
    env_file = helper.get_env_list()
    if not (env_file["PROJECT_SCHEME"].strip("\"") in schemes):
        helper.update_scheme(project_file, schemes[0])


def bind_autocomplete():
    if not helper.is_build_server_valid():
        print("RESTARTING XCODE BUILD SERVER")
        env = helper.get_env_list()
        subprocess.run(["sh", ".vscode/build_autocomplete.sh"], env=env)
        subprocess.run(["sh", ".vscode/restart_lsp_swift.sh"], env=env)
        print("Build Server is outdated")


if __name__ == "__main__":
    
    project_file = sys.argv[1]

    os.makedirs('.logs', exist_ok=True)
    if os.path.exists(project_file):
        print("valid project file")
        update_enviroment(project_file)
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
        print("Workspace existance: ", is_workspace)
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
                
        update_enviroment(project_file) 

    print("UPDATE BINDING")
    # validate build server
    bind_autocomplete()
        
    helper.update_git_exlude("buildServer.json")
    helper.update_git_exlude(".logs")
    helper.update_git_exlude(".vscode")
    