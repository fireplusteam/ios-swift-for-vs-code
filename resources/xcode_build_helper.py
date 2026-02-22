import sys
import pathlib

# import sibling folder from xcode-build-server
path_root = pathlib.Path(__file__).resolve().parent.parent
path_root = path_root / "xcode-build-server"
sys.path.append(str(path_root))

# import from xcode-build-server activitylog parser
from xcactivitylog import tokenizer, TokenType


def parse_xclogs(build_path):
    for type, value in tokenizer(build_path):
        # print(type, value)
        if type != TokenType.String:
            continue
        assert isinstance(value, str)
        lines = value.splitlines()
        if len(lines) >= 1:
            yield from iter(lines)
            yield ""  # a empty line means section log end
