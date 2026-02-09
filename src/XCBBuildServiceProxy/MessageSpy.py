from enum import Enum
from MessageReader import MessageReader


class MessageType(Enum):
    client_message = 1
    server_message = 2


class MessageSpyBase:
    def on_server_message(self, type: MessageType, message: MessageReader):
        pass
