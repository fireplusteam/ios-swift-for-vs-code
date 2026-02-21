import sys
import pathlib
import json
import os
import time
import gzip

# import sibling folder from xcode-build-server
path_root = pathlib.Path(__file__).resolve().parent.parent
path_root = path_root / "xcode-build-server"
sys.path.append(str(path_root))

# import from xcode-build-server activitylog parser
from xcactivitylog import tokenizer, TokenType

VERSION = "1.0.0"

HOT_RELOAD_LOG_XCLOG_KEY = "hot_reload_log_xclog.xcactivitylog"


class LogAccumulator:
    def __init__(self, log_accumulator_path):
        self.log_accumulator_path = log_accumulator_path
        self.dirty = False
        self.data = self._read_log_accumulator(log_accumulator_path)

    def set_log(self, file, line, st_ctime):
        hash_line = hash(line)

        if "hashes" not in self.data:
            self.data["hashes"] = {}
            self.dirty = True

        log_line_data = self.data["hashes"].get(hash_line, None)
        if log_line_data is None or log_line_data["st_ctime"] < st_ctime:
            self.data["hashes"][hash_line] = {"line": line, "st_ctime": st_ctime}
            self.dirty = True

        if "files" not in self.data:
            self.data["files"] = {}
            self.dirty = True
        if self.data["files"].get(file, None) != hash_line:
            self.dirty = True
            self.data["files"][file] = hash_line

    def set_parsed_xclog_files(self, parsed_xclog_files):
        if "parsed_xclog_files" not in self.data:
            self.data["parsed_xclog_files"] = {}
            self.dirty = True
        for f in parsed_xclog_files:
            self.data["parsed_xclog_files"][str(f)] = True
            self.dirty = True

    def _read_log_accumulator(self, log_accumulator_path):
        empty = {"version": VERSION}
        if log_accumulator_path.exists():
            try:
                with open(log_accumulator_path, "r") as f:
                    data = json.load(f)
                    if data["version"] != VERSION:
                        return empty
                    return data
            except:
                pass
        return empty

    def _clean_old_hashes(self):
        if not self.dirty:
            return
        valid_hashes = set()
        for _, hash_line in self.data.get("files", {}).items():
            valid_hashes.add(hash_line)
        self.data["hashes"] = {
            k: v for k, v in self.data.get("hashes", {}).items() if k in valid_hashes
        }
        self.dirty = False

    def save_log_accumulator(self):
        self._clean_old_hashes()
        with open(self.log_accumulator_path, "w") as f:
            json.dump(self.data, f)

    def dum_xclog_file(self, xclog_file):
        self._clean_old_hashes()
        lines = list(self.data.get("hashes", {}).values())
        # sort by st_ctime desc
        lines.sort(key=lambda x: -x["st_ctime"])
        lines = "\n\n".join([x["line"] for x in lines])
        # gunzip lines

        try:
            os.unlink(xclog_file)
        except:
            pass

        with gzip.open(xclog_file, "wb") as f:
            f.write(lines.encode("utf-8"))


def cmd_split(s):
    import shlex

    try:
        return shlex.split(s)  # shlex is more right
    except:
        return []


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


def get_all_xclog_files(xclog_path: pathlib.Path):
    # find all xclog files in xclog_path and sort them by creation date
    xclog_files = list(xclog_path.glob("*.xcactivitylog"))
    xclog_files.sort(key=lambda x: x.stat().st_ctime)
    return [x for x in xclog_files if HOT_RELOAD_LOG_XCLOG_KEY not in x.name]


def extract_all_logs(xclog_files):
    for xclog_file in xclog_files:
        raw_logs = parse_xclogs(str(xclog_file))
        for line in raw_logs:
            yield (line, xclog_file.stat().st_ctime)


def get_files_from_args(args):
    files = []
    for i in range(len(args)):
        if args[i] in ["-primary-file", "-c"]:
            if i + 1 < len(args) and args[i + 1].startswith("/"):
                files.append(args[i + 1])
    return files


if __name__ == "__main__":
    build_path = sys.argv[1]
    workspace_path = sys.argv[2]

    log_accumulator_path = (
        pathlib.Path(workspace_path)
        / ".vscode"
        / "xcode"
        / "logs"
        / "hotreloading_log_accumulator.json"
    )

    log_accumulator = LogAccumulator(log_accumulator_path)

    xclog_path = pathlib.Path(build_path) / "Logs" / "Build"

    def parse_line(line, st_ctime):
        if ("-primary-file" in line and "swift-frontend" in line) or (
            "-c" in line and "clang" in line
        ):
            args = cmd_split(line)

            files = get_files_from_args(args)
            if len(files) > 0:
                for file in files:
                    log_accumulator.set_log(file, line, st_ctime)

    xclog_files = get_all_xclog_files(xclog_path)
    for line, st_ctime in extract_all_logs(xclog_files):
        parse_line(line, st_ctime)

    log_accumulator.set_parsed_xclog_files(xclog_files)
    log_accumulator.save_log_accumulator()
    log_accumulator.dum_xclog_file(xclog_path / HOT_RELOAD_LOG_XCLOG_KEY)

    # watch for changes in xclog_path and parse new logs

    already_parsed_files = set(log_accumulator.data.get("parsed_xclog_files", []))
    while True:
        # add only new created files, because xcodebuild creates new xclog file for each build
        xclog_files = get_all_xclog_files(xclog_path)
        xclog_files = [f for f in xclog_files if str(f) not in already_parsed_files]

        for line, st_ctime in extract_all_logs(xclog_files):
            parse_line(line, st_ctime)

        already_parsed_files |= set(str(f) for f in xclog_files)
        log_accumulator.set_parsed_xclog_files(xclog_files)
        if len(xclog_files) > 0:
            log_accumulator.save_log_accumulator()
            log_accumulator.dum_xclog_file(xclog_path / HOT_RELOAD_LOG_XCLOG_KEY)

        time.sleep(5)
