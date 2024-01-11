import helper
import json

file_path = 'buildServer.json'

with open(file_path, 'r') as file:
    config = json.load(file)

build_root = config["build_root"]
scheme = config["scheme"]

helper.update_setting(build_path=build_root, target=scheme)