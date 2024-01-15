import sys
import xcutil
import json
import os


def get_test_name(lines, i):
    for j in range(i, len(lines)):
        if lines[j].isalpha():
            res = ""
            start_index = j
            while j < len(lines):
                if lines[j] == '(' or lines[j].isspace():
                    break
                res += lines[j]
                j += 1
            
            if res[:len("test")] == "test":
                return {"name": res, "pos": start_index}
            else:
                break
    
    return None


def get_tests(lines, get_test_name):
    tests = []

    for i in range(0,len(lines)):
        if "func" == lines[i:i + len("func")]:
            test_name = get_test_name(lines, i + len("func"))
            if test_name is not None:
                tests.append(test_name)
    return tests


def get_pos_on_class_line(lines, index):
    bracket = []
    while index > 0: 
        if lines[index] == '}':
            bracket.append(1)
        elif lines[index] == '{':
            if len(bracket) == 0: # that meant a line like 'class MyTest: XCTestCase {' as it's a bracket which has no closing bracket starting from test method
                return index
            else:  
                bracket.pop()
        index -= 1


def get_test_class(lines, test_pos):
    test_pos = test_pos
    pos_on_class = get_pos_on_class_line(lines, test_pos)
    if pos_on_class is None:
        return None
    index = pos_on_class
    while index >= 0:
        if "class" == lines[index - len("class") + 1:index + 1]:
            j = index + 1
            while lines[j].isspace():
                j += 1
            class_name = ""
            while not lines[j].isspace() and lines[j] != ':':
                class_name += lines[j]
                j += 1
            return class_name
        index -= 1
    return None

cache_file_path = ".vscode/.cache/tests_selection.json"
last_selected_tests_key = "Last_selected_tests_@546&8! random_key"


def get_tests_cache_config():
    with open(cache_file_path, 'r') as file:
        return json.load(file)
    return {}


def selected_tests(scheme_name, class_name):
    try:
        return get_tests_cache_config()[f"{scheme_name}/{class_name}"]
    except:
        return {}
    
    
def get_last_selected_tests():
    try:
        return get_tests_cache_config()[last_selected_tests_key]
    except:
        return {}
    

def store_selected_tests(tests):
    config = {}
    try:
        with open(cache_file_path, 'r') as file:
            config = json.load(file)
    except:
        pass

    if config is None:
        config = {}

    list = {}
    for test in tests:
        scheme, class_name, test_name = test.split("/")
        list.setdefault(f"{scheme}/{class_name}", []).append(test_name)
    
    for key, value in list.items():
        config[key] = value

    config[last_selected_tests_key] = tests

    os.makedirs(os.path.dirname(cache_file_path), exist_ok=True)
 
    with open(cache_file_path, 'w+') as file:
        json.dump(config, file, indent=2)    


if __name__ == "__main__":

    pupulated_tests = []
    try:
        project_file = sys.argv[1]
        selected_file = sys.argv[2]

        result = [project_file, selected_file]

        with open(selected_file, 'r') as file:
            lines = file.read()

        tests = []

        tests = get_tests(lines, get_test_name)

        scheme = xcutil.get_scheme_by_file_name(project_file, selected_file)

        tests = [{"test": test["name"], "class": get_test_class(lines, test["pos"]), "scheme": scheme} for test in tests]
        
        ext = os.path.splitext(selected_file)[1]
        is_last_tests = False
        if len(tests) == 0 or ext != ".swift" or scheme is None:
            is_last_tests = True
            tests = get_last_selected_tests()
            tests = [test.split('/') for test in tests]
            tests = [{"test": test[2], "class": test[1], "scheme": test[0]} for test in tests]

        for test in tests: 
            last_message = "@ " if is_last_tests else ""
            populated_test = {"label": last_message + f"{test['test']} -> {test['class']} -> {test['scheme']}", "value": f"{test['scheme']}/{test['class']}/{test['test']}"}
            picked_tests = selected_tests(scheme, test["class"])
            if test["test"] in picked_tests or is_last_tests:
                populated_test["picked"] = True
            
            pupulated_tests.append(populated_test)

        print(tests)

        if len(pupulated_tests) == 0:
            raise "Not valid"
    except:
        pupulated_tests = ["NO VALID TESTS FOR FILE"]
    finally:
        print(json.dumps(pupulated_tests))