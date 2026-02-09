from enum import Enum
import json


class MsgStatus(Enum):
    DetermineStart = 2
    MsgReadingLen = 3
    MsgReadingBody = 4
    MsgEnd = 5


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
    def feed(self, byte: bytes):
        self.offset += 1
        self.buffer += byte
        self.left_read_io_bytes -= 1

        assert len(byte) == 1, "feed method only accepts single byte"

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
            self.read_index += 1
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

    def parse_json_from_message(self) -> dict:
        message_body = self.message_body()
        # need the last occurrence
        json_start = message_body[1:].find(b"\xc5")  # two bytes json length
        json_offset = 0
        if json_start == -1:
            json_start = message_body[1:].find(b"\xc4")  # single byte json length
            if json_start == -1:
                # \xb9DEPENDENCY_GRAPH_RESPONSE\xc6\x00\x03\xc3Q{"adjacencyList":
                json_start = message_body[1:].find(b"\xc6")  # four bytes json length
                if json_start == -1:
                    return None
                else:
                    json_offset = 5
            else:
                json_offset = 2
        else:
            json_offset = 3
        json_start += 1  # skip the first byte which is the json length indicator
        json_len = int.from_bytes(
            message_body[json_start + 1 : json_start + json_offset], "big"
        )
        json_bytes = message_body[
            json_start + json_offset : json_start + json_offset + json_len
        ]
        json_str = json_bytes
        return json.loads(json_str)

    def message_body(self) -> bytearray:
        return self.buffer[12:]


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

    for i in test:
        buffer += i.to_bytes(1, "big")
    msg.buffer = buffer
    msg.parse_json_from_message()
