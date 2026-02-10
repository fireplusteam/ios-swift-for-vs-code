import asyncio
import time
from MessageSpy import MessageSpyBase, MessageType
from MessageReader import MessageReader, Message


class ServerBuildOperationMessageSpy(MessageSpyBase):
    def __init__(self):
        self._is_building = False
        self.sync_lock = asyncio.Lock()
        self.mtime_of_build_operation_cancelled_message = None

    @property
    def is_building(self):
        if self.mtime_of_build_operation_cancelled_message is not None:
            # 20 seconds to cancel build operation, after that we assume that build operation is ended as we haven't received BUILD_OPERATION_ENDED message
            if time.time() - self.mtime_of_build_operation_cancelled_message > 20:
                self.mtime_of_build_operation_cancelled_message = None
                self._is_building = False
        return self._is_building

    async def on_receive_message(self, type: MessageType, message: MessageReader):
        async with self.sync_lock:
            message: Message = message.getMessage()
            if type == MessageType.server_message:
                if message.message_code == b"BUILD_OPERATION_ENDED":
                    self._is_building = False
                    self.mtime_of_build_operation_cancelled_message = None
            if type == MessageType.client_message:
                if message.message_code == b"BUILD_START":
                    self.mtime_of_build_operation_cancelled_message = None
                    self._is_building = True
                elif message.message_code == b"BUILD_CANCEL":
                    self.mtime_of_build_operation_cancelled_message = time.time()
