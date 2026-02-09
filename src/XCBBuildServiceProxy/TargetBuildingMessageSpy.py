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
import asyncio
from MessageReader import MessageReader
from MessageSpy import MessageSpyBase, MessageType


def to_ascii_int_array(s: str):
    return [ord(c) for c in s]


def is_list_in_list(small_list, big_list):
    for i in range(len(big_list) - len(small_list) + 1):
        if big_list[i : i + len(small_list)] == small_list:
            return True
    return False


class TargetBuildingMessageSpy(MessageSpyBase):
    def __init__(self, output_file):
        self.output_file = output_file
        self.build_target_sessions = {}
        self.build_task_id_to_guid = {}
        self.target_ids_to_guid = {}
        self.reported_target_ids = set()
        self.is_cancelled = False
        self.sync_lock = asyncio.Lock()

    async def output(self, target, status):
        if self.output_file is None:
            return
        if target in self.reported_target_ids:
            return
        self.reported_target_ids.add(target)
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None, self.output_file.write, f"{status}:{target}:end_tail\n"
        )
        await loop.run_in_executor(None, self.output_file.flush)

    async def on_receive_message(self, type: MessageType, message: MessageReader):
        async with self.sync_lock:
            message_body = message.message_body()
            if type == MessageType.server_message:
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
                    self.target_ids_to_guid[
                        self.build_target_sessions[guid]["target_id"]
                    ] = guid
                elif message_body.startswith(b"\xb0BUILD_TASK_ENDED"):
                    json_data = message.parse_json_from_message()
                    if "signature" in json_data:
                        for target_id in self.target_ids_to_guid.keys():
                            guid = self.target_ids_to_guid[target_id]
                            target_signature = to_ascii_int_array(guid)
                            if is_list_in_list(
                                target_signature, json_data["signature"]
                            ):
                                status = json_data["status"]
                                if (
                                    status != 0
                                ):  # if status is not 0 then it's failed building a target
                                    await self.output(target_id, "Fail")
                elif message_body.startswith(b"\xb2BUILD_TARGET_ENDED"):
                    task_id = int.from_bytes(message_body[-8:], "big")
                    if task_id in self.build_task_id_to_guid:
                        guid = self.build_task_id_to_guid[task_id]
                        self.build_target_sessions[guid]["build_ended"] = True
                        target_id = self.build_target_sessions[guid]["target_id"]
                        if target_id in self.target_ids_to_guid:
                            if not self.is_cancelled:
                                await self.output(target_id, "Success")
                            else:
                                await self.output(target_id, "Cancelled")
                            del self.target_ids_to_guid[target_id]

            elif type == MessageType.client_message:
                if message_body.startswith(b"\xacBUILD_CANCEL"):
                    self.is_cancelled = True
