import sys
import helper
import populate_tests_of_current_file

project_file = sys.argv[1]
type = sys.argv[2]

env_list = helper.get_env_list()

print(env_list)

if type == "-destinationDevice":
    print("update destination device")
    
    device = sys.argv[3].split(' ')
    while len(device[-1]) == 0:
        device = device[:-1]
    print(f"new selected device: {device}")
    
    for item in device[-1].split(','):
        key, value = item.split('=')
        if key == "id":
            key = "DEVICE_ID"
        else:
            assert(False) 

        env_list[key] = "\"" + value + "\""
    
    helper.safe_env_list(env_list)
elif type == "-destinationScheme":
    scheme = sys.argv[3]
    
    helper.update_scheme(project_file, scheme)

elif type == "-destinationTests":
    error_message = "Not_defined"
    result = error_message
    try:
        tests = sys.argv[4]
        
        if tests == "CURRENTLY_SELECTED":
            tests = populate_tests_of_current_file.get_last_selected_tests()
        else:
            tests = tests.split()
        
        print("Tests: " + str(tests))

        populate_tests_of_current_file.store_selected_tests(tests)
        
        result = ""
        for test in tests:
            result += f"-only-testing:{test}"
            if test != test[-1]:
                result += " "
    except Exception as e:
        print(str(e))

        result = error_message
    finally:
        print(result)