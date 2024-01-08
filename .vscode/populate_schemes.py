import sys
import json
import helper

project_file = sys.argv[1]
project_scheme = sys.argv[2]

schemes = helper.get_schemes(project_file)

output = []
for scheme in schemes:
    if scheme == project_scheme:
        output.append({ "label": "$(notebook-state-success) " + scheme, "value": scheme, "picked": True})
    else:
        output.append({"label": scheme, "value": scheme})

output = json.dumps(output)

print(output)