import sys
import os
import helper
import subprocess


project_file = sys.argv[1]

os.makedirs('.logs', exist_ok=True)

if os.path.exists(project_file):
    print("valid project file")
    schemes = helper.get_schemes(project_file)
    env_file = helper.get_env_list()
    if not (env_file["PROJECT_SCHEME"].strip("\"") in schemes):
        helper.update_scheme(project_file, schemes[0])
else:
    print(f"{project_file} is not valid")

    cwd = os.getcwd()
    files = os.listdir(cwd)
    is_workspace = False
    for file in files:
        if ".xcworkspace" in file:
            is_workspace = True
            helper.update_project_file(file)
    print("Workspace existance: ", is_workspace)
    if not is_workspace:
        print(files, cwd)
        for file in files:
            if ".xcodeproj" in file:
                helper.update_project_file(file) 
                print(file)

# validate build server
if not helper.is_build_server_valid():
    env = helper.get_env_list()
    process = subprocess.run(["sh", ".vscode/build_autocomplete.sh"], env=env)
    process = subprocess.run(["sh", ".vscode/restart_lsp_swift.sh"], env=env)

    print("Build Server is outdated")
    
helper.update_git_exlude("buildServer.json")