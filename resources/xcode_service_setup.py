#!/usr/bin/env python3

import shutil
import sys
import os
import subprocess

is_install = sys.argv[1] == "-install"
isProxyInjected = sys.argv[1] == "-isProxyInjected"
local_service_path = sys.argv[2]

serviceName = local_service_path.split(os.path.sep)[-1]

xcode_dev_path = (
    subprocess.run("xcode-select -p", shell=True, capture_output=True, check=True)
    .stdout.decode("utf-8")
    .strip("\n")
)
xcode_dev_path_components = xcode_dev_path.split(os.path.sep)

if xcode_dev_path_components[-1] == "Developer":
    build_service_path = os.path.sep.join(xcode_dev_path_components[0:-1])
else:
    build_service_path = os.path.sep.join(xcode_dev_path_components)

build_service_path = os.path.join(
    build_service_path,
    (
        "SharedFrameworks/SwiftBuild.framework/Versions/A/PlugIns/SWBBuildService.bundle/Contents/MacOS"
        if serviceName == "SWBBuildService"
        else "SharedFrameworks/XCBuild.framework/Versions/A/PlugIns/XCBBuildService.bundle/Contents/MacOS"
    ),
)

service_origin_path = os.path.join(build_service_path, f"{serviceName}-origin")
service_path = os.path.join(build_service_path, serviceName)
if isProxyInjected:
    if os.path.exists(service_origin_path):
        exit(0)
    exit(1)

# inject proxy server
# to remove quarantine attribute from app use:

if is_install:
    if not os.path.exists(service_origin_path):
        shutil.copy(service_path, service_origin_path)

    try:
        os.unlink(service_path)
    except Exception as err:
        print(err)

    process = subprocess.run(
        f"ln -s '{local_service_path}' '{service_path}'",
        shell=True,
        capture_output=True,
        check=True,
    )

    print(process.stdout)
    print(process.stderr)
else:  # restore original service
    if not os.path.exists(service_origin_path):
        exit(0)

    os.unlink(service_path)
    shutil.copy(service_origin_path, service_path)
    os.remove(service_origin_path)
