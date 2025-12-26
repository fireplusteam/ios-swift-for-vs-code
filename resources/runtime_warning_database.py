#!/usr/bin/env python3
import json

DATA_BASE = dict()
ITEM_ID = 0

STORAGE_FILE = None


class SetEncoder(json.JSONEncoder):
    """
    JSON encoder for set and frozenset types.
    """

    def default(self, o):
        if isinstance(o, set) or isinstance(o, frozenset):
            data = dict()
            for key, value in o:
                data[key] = value
            return data
        return json.JSONEncoder.default(self, o)


def dump_database():
    """
    Dumps the runtime warning database to a FIFO file.
    """
    global STORAGE_FILE
    if STORAGE_FILE is None:
        STORAGE_FILE = open(
            ".vscode/xcode/fifo/.app_runtime_warnings.fifo", "w", 1, encoding="utf-8"
        )
    json_str = json.dumps(DATA_BASE, cls=SetEncoder)
    STORAGE_FILE.write(f"{json_str}\n")


class MessageInDatabaseError(Exception):
    pass


def store_runtime_warning(error_message: str, data: tuple):
    """
    Stores a runtime warning in the database.

    :param error_message: The error message.
    :type error_message: str
    :param data: The associated data.
    :type data: tuple
    """
    global ITEM_ID

    for _, value in DATA_BASE.items():
        if value["data"] == data:
            value["count"] += 1
            dump_database()
            raise MessageInDatabaseError("Message is already in database")

    DATA_BASE[f"element_{str(ITEM_ID)}"] = {
        "message": error_message,
        "count": 1,
        "data": data,
    }

    ITEM_ID += 1

    dump_database()
