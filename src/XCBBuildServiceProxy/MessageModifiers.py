import os
import base64
import json
from MessageReader import MessageReader
from BuildServiceUtils import is_behave_like_proxy


# c5 xx xx - format of json data
def modify_json_content(json_data):
    is_fed = False
    # log(f"Original parameters: {content[3:].decode('utf-8')}")

    continue_while_building = os.environ.get("continueBuildingAfterErrors", "False")
    single_file_building = os.environ.get("BUILD_XCODE_SINGLE_FILE_PATH", None)
    # log(f"ENV BUILD_XCODE_SINGLE_FILE_PATH: {single_file_building}")
    # log(f"ENV continueBuildingAfterErrors: {continue_while_building}")

    config = json.loads(json_data)

    # if False:
    if (
        "request" in config
        and "continueBuildingAfterErrors" in config["request"]
        and continue_while_building == "True"
    ):
        is_fed = True

        config["request"]["continueBuildingAfterErrors"] = True

        json_representation = config["request"]["jsonRepresentation"]
        json_representation = base64.b64decode(json_representation)
        # log("based64 origin: ")
        # log(json_representation)

        # modify json representation. NOTE: should be the same as config["request"]
        json_representation = json.loads(json_representation)
        json_representation["continueBuildingAfterErrors"] = True

        if (
            not single_file_building is None
        ):  # make a build command like for a single file
            buildCommand = {
                "command": "singleFileBuild",
                "files": [single_file_building],
            }
            config["request"]["buildCommand"] = buildCommand
            json_representation["buildCommand"] = buildCommand

        json_representation = json.dumps(
            json_representation, separators=(",", " : "), indent="  "
        )
        # log("base64 modified:")
        # log(json_representation.encode("utf-8"))
        json_representation = base64.b64encode(json_representation.encode("utf-8"))
        config["request"]["jsonRepresentation"] = json_representation.decode("utf-8")

    json_str = json.dumps(config, separators=(",", ":"))
    # log("Modified proxy parameters: " + json_str)
    json_bytes = json_str.encode("utf-8")
    return (json_bytes, is_fed)


class MessageModifierBase:
    def modify_content(self, message: MessageReader):
        pass


class ClientMessageModifier(MessageModifierBase):
    def __init__(self):
        self.is_fed = not is_behave_like_proxy()

    def modify_content(self, message_reader: MessageReader):
        if self.is_fed:
            return
        # manipulate message
        # there can be multiple occurrence of C5 byte, so we need to get the last one

        message = message_reader.getMessage()
        if message.message_code == b"CREATE_BUILD":
            new_content, is_fed = modify_json_content(message.json_data)
            message_reader.buffer[
                message.json_section_start
                + 1 : message.json_section_start
                + message.json_data_offset
            ] = len(new_content).to_bytes(message.json_data_offset - 1, "big")

            message_reader.modify_body(
                new_content,
                message.json_section_start + message.json_data_offset,
                message.json_section_start
                + message.json_data_offset
                + message.json_len,
            )
            if is_fed:
                self.is_fed = True
