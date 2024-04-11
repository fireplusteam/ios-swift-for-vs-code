import sys
import json
import helper

project_file = sys.argv[1]
project_configuration = sys.argv[2]

configurations = helper.get_schemes(project_file, is_build_configuration=True)

output = []
for configuration in configurations:
    if configuration == project_configuration:
        output.append({"label": "$(notebook-state-success) " + configuration, "value": configuration})
    else:
        output.append(configuration)

output = json.dumps(output)

print(output)