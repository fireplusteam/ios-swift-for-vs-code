import sys
import os
import helper
import subprocess

def update_enviroment(project_file):
    schemes = helper.get_schemes(project_file)
    env_file = helper.get_env_list()
    if not (env_file["PROJECT_SCHEME"].strip("\"") in schemes):
        helper.update_scheme(project_file, schemes[0])


if __name__ == "__main__":
    
    project_file = sys.argv[1]

    os.makedirs('.logs', exist_ok=True)
    should_update_settings = False
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
                should_update_settings = True
        print("Workspace existance: ", is_workspace)
        if not is_workspace:
            print(files, cwd)
            for file in files:
                if ".xcodeproj" in file:
                    helper.update_project_file(file) 
                    print(file)
                    project_file = file
                    should_update_settings = True
        if should_update_settings == False:
            for file in files:
                if "Package.swift" in file:
                    helper.update_project_file(file)
                    print(file)
                    project_file = file
                    should_update_settings = True
        update_enviroment(project_file) 


    # validate build server
    if not helper.is_build_server_valid() or should_update_settings:
        env = helper.get_env_list()
        process = subprocess.run(["sh", ".vscode/build_autocomplete.sh"], env=env)
        process = subprocess.run(["sh", ".vscode/restart_lsp_swift.sh"], env=env)

        print("Build Server is outdated")
        
    helper.update_git_exlude("buildServer.json")