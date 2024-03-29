#!/usr/bin/env python3

import shutil
import sys
import os
import subprocess

is_install = sys.argv[1] == "-install"
isProxyInjected = sys.argv[1] == "-isProxyInjected"

xcode_dev_path = subprocess.run("xcode-select -p", shell=True, capture_output=True).stdout.decode("utf-8").strip("\n")
xcode_dev_path_components = xcode_dev_path.split(os.path.sep)

if xcode_dev_path_components[-1] == "Developer":
    build_service_path = os.path.sep.join(xcode_dev_path_components[0: -1])
else:
    build_service_path = os.path.sep.join(xcode_dev_path_components)

build_service_path = os.path.join(build_service_path, "SharedFrameworks/XCBuild.framework/Versions/A/PlugIns/XCBBuildService.bundle/Contents/MacOS")

service_origin_path = os.path.join(build_service_path, "XCBBuildService-origin")
service_path = os.path.join(build_service_path, "XCBBuildService")

if isProxyInjected:
    if os.path.exists(service_origin_path):
        exit(0)
    exit(1)
        
# inject proxy server
local_service_path = sys.argv[2]

if is_install:
    if not os.path.exists(service_origin_path):
        shutil.copy(service_path, service_origin_path)

    try:
        os.unlink(service_path)
    except Exception as err:
        print(err)
    
    process = subprocess.run(f"ln -s '{local_service_path}' '{service_path}'", shell=True, capture_output=True)
    
    print(process.stdout)
    print(process.stderr)
else:
    if not os.path.exists(service_origin_path):
       exit(0) 
    os.unlink(service_path)
    shutil.copy(service_origin_path, service_path)
    os.remove(service_origin_path)