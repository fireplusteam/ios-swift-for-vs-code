import asyncio
from MessageSpy import MessageSpyBase, MessageType
from MessageReader import MessageReader, Message


class ServerBuildOperationMessageSpy(MessageSpyBase):
    def __init__(self):
        self.is_building = False
        self.sync_lock = asyncio.Lock()

    async def on_receive_message(self, type: MessageType, message: MessageReader):
        async with self.sync_lock:
            message: Message = message.getMessage()
            if type == MessageType.server_message:
                if message.message_code == b"BUILD_OPERATION_ENDED":
                    self.is_building = False
            if type == MessageType.client_message:
                if message.message_code == b"BUILD_START":
                    self.is_building = True
                # elif message.message_code == b"BUILD_CANCEL":
                #     self.is_building = False
