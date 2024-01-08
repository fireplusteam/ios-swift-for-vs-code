import sys
import helper

type = sys.argv[1]

env_list = helper.get_env_list()

print(env_list)

if type == "-destinationDevice":
    print("update destination device")
    
    device = sys.argv[2].split('|')
    while len(device[-1]) == 0:
        device = device[:-1]
    print(f"new selected device: {device}")
    
    for item in device[-1].split(','):
        key, value = item.split('=')
        if key == "platform":
            key = "PLATFORM"
        elif key == "OS":
            key = "PLATFORM_OS"
        elif key == "name":
            key = "DEVICE_NAME"
        elif key == "id":
            key = "DEVICE_ID"
        else:
            assert(False) 

        env_list[key] = "\"" + value + "\""
    
    helper.safe_env_list(env_list)
elif type == "-destinationScheme":
    scheme = sys.argv[2]
    
    env_list["PROJECT_SCHEME"] = "\"" + scheme + "\""
    helper.safe_env_list(env_list)

    print("update sheme")