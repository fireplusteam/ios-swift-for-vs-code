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
    allKeys = device.split(',')
    hasId = False
    hasPlatform = False
    for pair in allKeys:
        key, value = pair.split('=')
        if key == "id":
            key = "DEVICE_ID"
            hasId = True
        elif key == "platform":
            key = "PLATFORM"
            hasPlatform = True
            if value == "macOS":
                value = "macosx"
            elif value == "iOS Simulator":
                value = "iphonesimulator"
        else:
            assert(False) 

        env_list[key] = "\"" + value + "\""
    
    if hasId == False:
        assert(False, "Destination ID is not set")
    
    if hasPlatform == False:
        assert(False, "Destination Platform is not set")
    
    helper.safe_env_list(env_list)
elif type == "-destinationScheme":
    scheme = sys.argv[3]
    print("Selected Target: " + scheme)
    helper.update_scheme(project_file, scheme)
elif type == "-destinationConfiguration":
    configuration = sys.argv[3]
    print("Selected Target: " + configuration)
    helper.update_configuration(project_file, configuration)