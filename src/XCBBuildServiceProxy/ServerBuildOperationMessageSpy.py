import asyncio
from MessageSpy import MessageSpyBase, MessageType


class ServerBuildOperationMessageSpy(MessageSpyBase):
    def __init__(self):
        self.is_building = False
        self.sync_lock = asyncio.Lock()

    async def on_receive_message(self, type: MessageType, message):
        async with self.sync_lock:
            message_body = message.message_body()
            if type == MessageType.server_message:
                if message_body.startswith(b"\xb5BUILD_OPERATION_ENDED"):
                    self.is_building = False
            if type == MessageType.client_message:
                if message_body.startswith(b"\xabBUILD_START"):
                    self.is_building = True
                elif message_body.startswith(b"\xacBUILD_CANCEL"):
                    self.is_building = False
