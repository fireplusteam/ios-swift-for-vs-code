from enum import Enum
import json


class MsgStatus(Enum):
    DetermineStart = 2
    MsgReadingLen = 3
    MsgReadingBody = 4
    MsgEnd = 5


class Message:
    def __init__(self, buffer: bytearray):
        def json_offset(message_data: bytearray) -> dict:
            if message_data[0:1] == b"\xc4":
                return 2
            elif message_data[0:1] == b"\xc5":
                return 3
            elif message_data[0:1] == b"\xc6":
                return 5

        def has_prefix(message_data: bytearray, prefix: bytes) -> bool:
            return message_data[0 : len(prefix)] == prefix

        def message_code(message_data: bytearray) -> bytes:
            if has_prefix(message_data, b"\xacCREATE_BUILD"):
                return b"CREATE_BUILD"
            if has_prefix(message_data, b"\xaeCREATE_SESSION"):
                return b"CREATE_SESSION"
            if has_prefix(message_data, b"\xb4BUILD_TARGET_STARTED"):
                return b"BUILD_TARGET_STARTED"
            if has_prefix(message_data, b"\xb0BUILD_TASK_ENDED"):
                return b"BUILD_TASK_ENDED"
            if has_prefix(message_data, b"\xb2BUILD_TARGET_ENDED"):
                return b"BUILD_TARGET_ENDED"
            if has_prefix(message_data, b"\xb5BUILD_OPERATION_ENDED"):
                return b"BUILD_OPERATION_ENDED"
            if has_prefix(message_data, b"\xabBUILD_START"):
                return b"BUILD_START"
            if has_prefix(message_data, b"\xacBUILD_CANCEL"):
                return b"BUILD_CANCEL"

        self.message = buffer
        self.message_body = buffer[12:]

        self.message_code = message_code(self.message_body)
        if self.message_code is None:
            # we only parse known message codes required for this extension
            return
        self.message_code_len = len(self.message_code)

        self.message_data = self.message_body[1 + self.message_code_len :]

        self.json_section_start = 12 + 1 + self.message_code_len

        self.json_data_offset = json_offset(self.message_data)
        if self.json_data_offset is not None:
            self.json_len = int.from_bytes(
                self.message_data[1 : self.json_data_offset],
                "big",
            )
            self.json_data = self.message_data[
                self.json_data_offset : self.json_data_offset + self.json_len
            ]

    def json(self):
        if self.json_data_offset is not None:
            return json.loads(self.json_data)
        else:
            return None


class MessageReader:

    def __init__(self) -> None:
        self.status = MsgStatus.DetermineStart
        self.buffer = bytearray()
        self.read_index = 0
        self.msg_len = 0
        self.offset = 0
        self.left_read_io_bytes = 12

    def expecting_bytes_from_io(self) -> int:
        return self.left_read_io_bytes

    # feed with only a single byte
    # first 8 bytes are the message id as a counter number, the next 4 bytes are the length of the message
    # message form: 00 00 00 00 00 00 00 00 xx xx xx xx message
    # where xx is little endian 4 bytes int to indicate the length of message
    # json data starts with c4, yy | c5 yy yy | c6 yy yy yy yy, where c5 indicates starts of json and yy yy the length of json
    def feed(self, all_bytes: bytes):
        self.offset += len(all_bytes)
        self.buffer.extend(all_bytes)

        if (
            self.status == MsgStatus.DetermineStart
            or self.status == MsgStatus.MsgReadingLen
        ):
            for _ in all_bytes:
                self.left_read_io_bytes -= 1
                if self.status == MsgStatus.DetermineStart:
                    self.read_index += 1
                    if self.read_index == 8:
                        self.status = MsgStatus.MsgReadingLen
                        self.read_index = 0
                        self.msg_len = 0

                elif self.status == MsgStatus.MsgReadingLen:
                    self.read_index += 1
                    if self.read_index == 4:
                        self.msg_len = int.from_bytes(self.buffer[8 : 8 + 4], "little")
                        assert (
                            self.left_read_io_bytes == 0
                        ), "left_read_io_bytes should be 0 when reading length"
                        self.left_read_io_bytes = self.msg_len
                        self.read_index = 0
                        self.status = MsgStatus.MsgReadingBody
                elif self.status == MsgStatus.MsgReadingBody:
                    self.left_read_io_bytes -= 1
                    self.read_index += 1
                    if self.read_index == self.msg_len:
                        self.status = MsgStatus.MsgEnd

        elif self.status == MsgStatus.MsgReadingBody:
            self.left_read_io_bytes -= len(all_bytes)
            self.read_index += len(all_bytes)

            if self.read_index == self.msg_len:
                self.status = MsgStatus.MsgEnd

    def reset(self):
        self.read_index = 0
        self.buffer = bytearray()
        self.msg_len = 0
        assert (
            self.left_read_io_bytes == 0
        ), "left_read_io_bytes should be 0 when resetting"
        self.left_read_io_bytes = 12
        self.status = MsgStatus.DetermineStart

    def modify_body(
        self,
        new_content,
        start_pos: int,
        end_pos: int = -1,
    ):
        if end_pos == -1:
            end_pos = len(self.buffer)
        assert start_pos >= 12
        self.buffer[start_pos:end_pos] = new_content
        self.msg_len -= end_pos - start_pos
        self.msg_len += len(new_content)
        self.buffer[8 : 8 + 4] = self.msg_len.to_bytes(4, "little")

    def getMessage(self) -> Message:
        assert self.status == MsgStatus.MsgEnd, "message is not fully read yet"
        return Message(self.buffer)


if __name__ == "__main__":
    msg = MessageReader()
    # tests
    buffer = bytearray()
    test = [
        9,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        147,
        0,
        0,
        0,
        176,
        66,
        85,
        73,
        76,
        68,
        95,
        84,
        65,
        83,
        75,
        95,
        69,
        78,
        68,
        69,
        68,
        196,
        128,
        123,
        34,
        105,
        100,
        34,
        58,
        49,
        44,
        34,
        115,
        105,
        103,
        110,
        97,
        108,
        108,
        101,
        100,
        34,
        58,
        102,
        97,
        108,
        115,
        101,
        44,
        34,
        115,
        105,
        103,
        110,
        97,
        116,
        117,
        114,
        101,
        34,
        58,
        91,
        49,
        44,
        57,
        57,
        44,
        49,
        49,
        49,
        44,
        49,
        48,
        57,
        44,
        49,
        49,
        50,
        44,
        49,
        49,
        55,
        44,
        49,
        49,
        54,
        44,
        49,
        48,
        49,
        44,
        57,
        53,
        44,
        49,
        49,
        54,
        44,
        57,
        55,
        44,
        49,
        49,
        52,
        44,
        49,
        48,
        51,
        44,
        49,
        48,
        49,
        44,
        49,
        49,
        54,
        44,
        57,
        53,
        44,
        49,
        48,
        51,
        44,
        49,
        49,
        52,
        44,
        57,
        55,
        44,
        49,
        49,
        50,
        44,
        49,
        48,
        52,
        93,
        44,
        34,
        115,
        116,
        97,
        116,
        117,
        115,
        34,
        58,
        48,
        125,
    ]

    msg.feed(test)
    message = msg.getMessage()
    json = message.json()
