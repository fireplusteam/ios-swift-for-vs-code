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
from MessageReader import MessageReader, Message, MsgStatus
from MessageSpy import MessageSpyBase, MessageType
from TrieSignature import TrieSignature

LOG_TO_FILE = False

LOG_FILE_NAME = "/Users/Ievgenii_Mykhalevskyi/repos/log_file.txt"

LOG_FILE = None
if LOG_TO_FILE:
    LOG_FILE = open(LOG_FILE_NAME, "wb")


def to_ascii_int_array(s: str):
    return [ord(c) for c in s]


# for debug purposes
def print_signature(signature):
    print("".join([chr(b) for b in signature]))


class TargetBuildingMessageSpy(MessageSpyBase):
    def __init__(self, output_file):
        self.output_file = output_file
        self.build_target_sessions = {}
        self.build_task_id_to_target_guid = {}
        self.reported_target_ids = set()
        self.is_cancelled = False
        self.sync_lock = asyncio.Lock()
        self.trie_signature = TrieSignature()

    def log(self, message: Message):
        if LOG_FILE:
            LOG_FILE.write(message.message)
            LOG_FILE.flush()

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
            message: Message = message.getMessage()
            if type == MessageType.server_message:
                if message.message_code == b"BUILD_TARGET_STARTED":
                    self.log(message)
                    json_data = message.json()
                    target_guid = json_data["guid"]
                    target_id = f"{json_data['info']['projectInfo']['path']}::{json_data['info']['name']}"
                    self.build_target_sessions[target_guid] = {
                        "build_started": True,
                        "build_ended": False,
                        "id": json_data["id"],
                        "target_id": target_id,
                    }
                    self.build_task_id_to_target_guid[json_data["id"]] = target_guid
                    target_signature = to_ascii_int_array(target_guid)
                    self.trie_signature.insert(
                        target_signature, (target_id, target_guid)
                    )
                elif message.message_code == b"BUILD_TASK_ENDED":
                    self.log(message)
                    json_data = message.json()
                    if "signature" in json_data:
                        signature = json_data["signature"]
                        for i in range(len(signature)):
                            data = self.trie_signature.search_any(signature, i)
                            if data is not None:
                                target_id, _ = data
                                status = json_data["status"]
                                if (
                                    status != 0
                                ):  # if status is not 0 then it's failed building a target
                                    await self.output(target_id, "Fail")
                elif message.message_code == b"BUILD_TARGET_ENDED":
                    self.log(message)
                    task_id = int.from_bytes(message.message_body[-8:], "big")
                    if task_id in self.build_task_id_to_target_guid:
                        target_guid = self.build_task_id_to_target_guid[task_id]
                        session = self.build_target_sessions[target_guid]
                        if not session["build_ended"]:
                            target_id = session["target_id"]
                            session["build_ended"] = True

                            target_signature = to_ascii_int_array(target_guid)
                            self.trie_signature.remove_signature(target_signature)

                            if not self.is_cancelled:
                                await self.output(target_id, "Success")
                            else:
                                await self.output(target_id, "Cancelled")

            elif type == MessageType.client_message:
                if message.message_code == b"BUILD_CANCEL":
                    self.is_cancelled = True


if __name__ == "__main__":
    import time

    # test from log file

    async def run():

        with open(LOG_FILE_NAME, "rb") as input:
            msg = MessageReader()

            spy = TargetBuildingMessageSpy(None)

            while True:
                rb = input.read(msg.expecting_bytes_from_io())
                if not rb:
                    break
                for b in rb:
                    msg.feed(b.to_bytes(1, "big"))
                    if msg.status == MsgStatus.MsgEnd:
                        await spy.on_receive_message(MessageType.server_message, msg)
                        msg.reset()

    start_time = time.time()
    asyncio.run(run())
    print(f"Time taken: {time.time() - start_time} seconds")
