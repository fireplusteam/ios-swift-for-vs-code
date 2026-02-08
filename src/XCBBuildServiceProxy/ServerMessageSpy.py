# DOC: Here is the server messages example on how it communicate with a client about a target is building, example contains Package.swit file and native Xcode target

# 1. when a target is starting to build the following message is sent:
# SERVER: bytearray(b'\xb4BUILD_TARGET_STARTED\xc5\x01r{"guid":"PACKAGE-TARGET:MyLibrary","id":0,"info":{"configurationIsDefault":false,"configurationName":"Debug","name":"MyLibrary","projectInfo":{"isNameUniqueInWorkspace":true,"isPackage":true,"name":"MyLibrary_Package","path":"/Users/Ievgenii_Mykhalevskyi/tests/out_files_project/SomeProject/MyLibrary/Package.swift"},"sdkroot":"iphonesimulator26.0","typeName":"Native"}}')
# SERVER: bytearray(
#     b'\xb4BUILD_TARGET_STARTED\xc5\x01\x95{"guid":"5ed01a15b7ac6a814c119741f047c8d431133c17e02351b11c14e9b11c641a93","id":1,"info":{"configurationIsDefault":false,"configurationName":"Debug","name":"SomeProject","projectInfo":{"isNameUniqueInWorkspace":true,"isPackage":false,"name":"SomeProject","path":"/Users/Ievgenii_Mykhalevskyi/tests/out_files_project/SomeProject/SomeProject.xcodeproj"},"sdkroot":"iphonesimulator26.0","typeName":"Native"}}'
# )

# 2. when a subtask for a target is completed, the following data is containing in the:
# SERVER: bytearray(b'\xb0BUILD_TASK_ENDED\xc5\x02c{"id":14,"metrics":{"maxRSS":0,"stime":325194,"utime":325194,"wcDuration":325194,"wcStartTime":792181065463783},"signalled":false,"signature":[0,80,50,58,116,97,114,103,101,116,45,77,121,76,105,98,114,97,114,121,45,80,65,67,75,65,71,69,45,84,65,82,71,69,84,58,77,121,76,105,98,114,97,114,121,45,83,68,75,82,79,79,84,58,105,112,104,111,110,101,115,105,109,117,108,97,116,111,114,58,83,68,75,95,86,65,82,73,65,78,84,58,105,112,104,111,110,101,115,105,109,117,108,97,116,111,114,58,68,101,98,117,103,58,57,97,97,99,55,51,100,97,48,101,52,49,56,55,54,50,55,51,55,51,50,49,57,50,97,53,52,57,54,100,52,56],"status":0}')
# where signature is simply the ascii int array of guid of target concatenated together indicating which targets are included in the ended task. If status is 0 then it's successful, otherwise it fails.
# PACKAGE-TARGET:MyLibrary = 80,65,67,75,65,...

# 3. after xd3 the id of build target task which is ended. At this point we can figure out if we need to build further or not.
# SERVER: bytearray(b'\xb2BUILD_TARGET_ENDED\x91\xd3\x00\x00\x00\x00\x00\x00\x00\x02')

import sys
from MessageReader import MessageReader
from BuildServiceUtils import get_targets_ids


def to_ascii_int_array(s: str):
    return [ord(c) for c in s]


class ServerMessageSpyBase:
    def on_server_message(self, message: MessageReader):
        pass


class ServerMessageSpy(ServerMessageSpyBase):
    def __init__(self, output_file):
        self.output_file = output_file
        self.build_target_sessions = {}
        self.building_target_ids = set(get_targets_ids())
        self.build_task_id_to_guid = {}
        self.target_ids_to_guid = {}

    def output(self, data: bytes):
        if self.output_file is None:
            return
        self.output_file.write(data)
        self.output_file.flush()

    def on_server_message(self, message: MessageReader):
        message_body = message.message_body()
        if message_body.startswith(b"\xb4BUILD_TARGET_STARTED"):
            json_data = message.parse_json_from_message()
            guid = json_data["guid"]
            self.build_target_sessions[guid] = {
                "build_started": True,
                "build_ended": False,
                "id": json_data["id"],
                "target_id": f"{json_data['info']['projectInfo']['path']}::{json_data['info']['name']}",
            }
            self.build_task_id_to_guid[json_data["id"]] = guid
            self.target_ids_to_guid[self.build_target_sessions[guid]["target_id"]] = (
                guid
            )
        elif message_body.startswith(b"\xb0BUILD_TASK_ENDED"):
            json_data = message.parse_json_from_message()
            if "signature" in json_data:
                left_targtet_ids = self.building_target_ids.copy()
                for target_id in self.building_target_ids:
                    if target_id not in self.target_ids_to_guid:
                        continue
                    guid = self.target_ids_to_guid[target_id]
                    target_signature = to_ascii_int_array(guid)
                    if target_signature in json_data["signature"]:
                        for guid, session in self.build_target_sessions.items():
                            if session["id"] == json_data["id"]:
                                status = json_data["status"]
                                if (
                                    status != 0
                                ):  # if status is not 0 then it's failed building a target
                                    self.output(f"Fail:{target_id}\n")
                                    left_targtet_ids.remove(target_id)
                self.building_target_ids = left_targtet_ids
        elif message_body.startswith(b"\xb2BUILD_TARGET_ENDED"):
            task_id = int.from_bytes(message_body[-8:], "big")
            if task_id in self.build_task_id_to_guid:
                guid = self.build_task_id_to_guid[task_id]
                self.build_target_sessions[guid]["build_ended"] = True
                target_id = self.build_target_sessions[guid]["target_id"]
                if target_id in self.building_target_ids:
                    self.output(f"Success:{target_id}\n")
                    self.building_target_ids.remove(target_id)
