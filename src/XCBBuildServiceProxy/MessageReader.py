from enum import Enum

class MsgStatus(Enum):
    FirstByte = 1
    DetermineStart = 2
    MsgReadingLen = 3
    MsgReadingBody = 4
    MsgEnd = 5


class MessageReader:
    
    def __init__(self) -> None:
        self.status = MsgStatus.FirstByte
        self.buffer = bytearray()
        self.read_index = 0
        self.msg_len = 0
        self.offset = 0
        

    # feed with only a single byte
    # message form: 00 00 00 00 00 00 00 xx xx xx xx message
    # where xx is little endian 4 bytes int to indicate the length of message
    # json data starts with c5 yy yy, where c5 indicates starts of json and yy yy the length of json
    def feed(self, byte):
        self.offset += 1
        self.buffer += byte
        match self.status:
            case MsgStatus.FirstByte:
                self.read_index = 0
                self.status = MsgStatus.DetermineStart
            case MsgStatus.DetermineStart:
                self.read_index += 1
                if self.read_index == 7:
                    self.status = MsgStatus.MsgReadingLen
                    self.read_index = 0
                    self.msg_len = 0
            
            case MsgStatus.MsgReadingLen:
                self.msg_len += int.from_bytes(byte) << (8 * self.read_index)
                self.read_index += 1
                if self.read_index == 4:
                    self.read_index = 0
                    self.status = MsgStatus.MsgReadingBody
                    
            case MsgStatus.MsgReadingBody:
                self.read_index += 1
                if self.read_index == self.msg_len:
                    self.status = MsgStatus.MsgEnd
              
                    
    def reset(self):
        self.read_index = 0
        self.buffer = bytearray()
        self.msg_len = 0
        self.status = MsgStatus.FirstByte
        
        
    def modify_body(self, new_content, start_pos: int,end_pos: int = -1,):
        if end_pos == -1:
            end_pos = len(self.buffer)
        assert(start_pos >= 12)
        self.buffer[start_pos:end_pos] = new_content
        self.msg_len -= end_pos - start_pos
        self.msg_len += len(new_content)
        self.buffer[8:8 + 4] = self.msg_len.to_bytes(4, "little")