import sys
import helper

project_file = sys.argv[1]
type = sys.argv[2]

env_list = helper.get_env_list()

print(env_list)


if type == "-multipleDestinationDevices":
    print("update multiple destination device")
    
    devices = sys.argv[3]
    print(f"New Multiple Devices are: {devices}")
    key = "MULTIPLE_DEVICE_ID"
    env_list[key] = "\"" + devices + "\""
    helper.safe_env_list(env_list) 

elif type == "-destinationDevice":
    print("update destination device")

    device = sys.argv[3]
    
    print(f"new selected device: {device}")
    key, value = device.split('=')
    if key == "id":
        key = "DEVICE_ID"
    else:
        assert(False) 

    env_list[key] = "\"" + value + "\""
    
    helper.safe_env_list(env_list)
elif type == "-destinationScheme":
    scheme = sys.argv[3]
    print("Selected Target: " + scheme)
    helper.update_scheme(project_file, scheme)
elif type == "-destinationConfiguration":
    configuration = sys.argv[3]
    print("Selected Target: " + configuration)
    helper.update_configuration(project_file, configuration)