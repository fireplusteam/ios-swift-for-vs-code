# Last line containing parsable JSON will be available in the selection list

# Simple labels
#echo '["A", "B", "C"]'

# Labels with icons
# https://code.visualstudio.com/api/references/icons-in-labels

#xcodebuild -workspace $PROJECT_FILE -scheme $PROJECT_SCHEME -showdestinations

#echo '[ { "label": "$(notebook-state-success) A", "value": "A", "picked": true }, { "label": "$(notebook-state-error) B", "value": "B" }, { "label": "$(notifications-configure) C", "value": "C" } ]'

import sys
import subprocess
import json

project_file = sys.argv[1]
project_scheme = sys.argv[2]

selected_destination = sys.argv[3]
print(selected_destination)

command = ["xcodebuild", "-workspace", project_file, "-scheme", project_scheme, "-showdestinations"]    
process = subprocess.run(command, capture_output=True, text=True, timeout=5)

if process.returncode != 0:
    print(f"Error by Getting the list of devices: {process.returncode}")
    exit(1)

output = process.stdout.strip().splitlines()

devices =[x for x in output if "platform:" in x]

device_list = []
is_device_selected = False
for device_line in devices:
    formatted =  ''.join([' ' if char in "{}" else char for char in device_line]).strip().split(',')
    formatted = [x.strip() for x in formatted]
    formatted_key = ""
    formatted_value = ""
    isValid = True
    for i in formatted:
        keyValue = i.split(':')
        if len(keyValue) != 2:
            isValid = False
            break
        if keyValue[0] != "id":
            if len(formatted_key) != 0:
                formatted_key += ','
            formatted_key += keyValue[0] + "=" + keyValue[1]

        if len(formatted_value) != 0:
                formatted_value += ','
        formatted_value += keyValue[0] + "=" + keyValue[1]

    if isValid:
        item = {"label": formatted_key, "value": "|" + formatted_value + "|"}
        if selected_destination == formatted_value and not is_device_selected:
            is_device_selected = True
            item["picked"] = True
            item["label"] = "$(notebook-state-success) " + formatted_key
        device_list.append(item)


formattedJson = json.dumps(device_list)

print(formattedJson)
# to test
#print('["A", "B", "C"]')
#print('[ { "label": "$(notebook-state-success) A", "value": "A", "picked": true }, { "label": "$(notebook-state-error) B", "value": "B" }, { "label": "$(notifications-configure) C", "value": "C" } ]')

