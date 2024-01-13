import subprocess
import json
import os
import sys

class XCProjectUtil:

    def __init__(self, project_file):
        project_file += "/project.pbxproj"

        result_path = ".vscode/project.json"
        process = subprocess.run(["plutil", "-convert", "json", "-o", result_path, project_file], capture_output=True)
        if process.returncode != 0:
            print(process.stdout)        
            print(f"Error converting {project_file} to json")
            raise Exception(f"Error converting {project_file} to json")

        with open(result_path, "r") as file:
            config = json.load(file)

        self.objects = config["objects"]
        self.rootObject = config["rootObject"]
        
    def object(self, id):
        if self.is_object(id):
            return self.objects[id]
        return id
    
    def is_object(self, id):
        if isinstance(id, str):
            return id in self.objects
        return False

    def resolveObject(self, object):
        if isinstance(object, list):
            res = []
            for child in object:
                res.append(self.resolveObject(child))
            return res
        elif isinstance(object, dict):
            res = {}
            for key, child in object.items():
                res[key] = self.resolveObject(child)
            return res
        elif isinstance(object, str):
            return self.object(object)


class XCProjectPath:

    def __init__(self, util: XCProjectUtil, root = None):
        self.util = util
        if root is not None:
            self._root = root
        else:
            self._root = util.rootObject

        self._object = util.resolveObject(self._root)
        self._index = 0
        self.value = self._object

    def __getitem__(self, key):
        return XCProjectPath(project_util, root=self._object[key])
    
    def __iter__(self):
        self._index = 0
        return self
    
    def __next__(self):
        if self._index < len(self._object):
            result = self._object[self._index]
            self._index += 1
            return XCProjectPath(project_util, result)
        else:
            raise StopIteration


#project_file = os.getenv("PROJECT_FILE")
#project_scheme = os.getenv("PROJECT_SCHEME")
#destination = f"id={os.getenv('DEVICE_ID')}"

project_util = XCProjectUtil("TestVSCode/TestVSCode.xcodeproj")
xc_path = XCProjectPath(project_util)

for target in xc_path["targets"]:
    name = target["name"]
    print("Target name: " + str(name.value))
    build_phases = target["buildPhases"]
    for build_phase in build_phases:
        files = build_phase["files"]
        for file in files:
            file_ref = file["fileRef"]
            path = file_ref["path"]
            print(path.value)
          

#plutil -convert json -o project.json TestVSCode/TestVSCode.xcodeproj/project.pbxproj

#TestVSCodeTests/TestVSCodeTests/testExample3


