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
import helper
from pprint import pprint
import os

project_file = sys.argv[1]
project_scheme = sys.argv[2]

selected_destination = sys.argv[3]

is_multi_selection = sys.argv[4]

print("DEST DEVICES: " + selected_destination)

if is_multi_selection == '-multi':
    selected_destination = selected_destination.split(' ')
else:
    selected_destination = [selected_destination]

command = ["xcodebuild", helper.get_project_type(project_file), project_file, "-scheme", project_scheme, "-showdestinations"]    
process = subprocess.run(command, capture_output=True, text=True, timeout=5)

if process.returncode != 0:
    print(f"Error by Getting the list of devices: {process.returncode}")
    exit(1)

output = process.stdout.strip().splitlines()
#print(output)

devices =[x for x in output if "platform:" in x]

device_list_multi = []
for device_line in devices:
    formatted =  ''.join([' ' if char in "{}" else char for char in device_line]).strip().split(',')
    formatted = [x.strip() for x in formatted]
    formatted_key = ""
    formatted_value = ""
    isValid = True
    for i in formatted:
        pos = i.find(":")
        if pos == -1:
            isValid = False
            break
        key, value = [i[:pos], i[pos + 1:]]
        if key != "id":
            if len(formatted_key) != 0:
                formatted_key += ','
            formatted_key += key + "=" + value

        if key == 'id':
            if len(formatted_value) != 0:
                formatted_value += ','
            formatted_value += key + "=" + value

    if isValid:
        selected_list = [x for x in selected_destination if x in formatted_value]
        item_multi = {"label": formatted_key, "value": formatted_value}
        if len(selected_list) > 0:
            if is_multi_selection == '-multi':
                item_multi["picked"] = True    
            item_multi["label"] = "$(notebook-state-success) " + formatted_key
        

        device_list_multi.append(item_multi)


formattedJson = json.dumps(device_list_multi)

print(formattedJson)
# to test
#print('["A", "B", "C"]')
#print('[ { "label": "$(notebook-state-success) A", "value": "A", "picked": true }, { "label": "$(notebook-state-error) B", "value": "B" }, { "label": "$(notifications-configure) C", "value": "C" } ]')

