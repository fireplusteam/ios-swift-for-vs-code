#!/usr/bin/env python3
import sys
import pathlib
import json
import os
import time
import gzip
import hashlib
from xcode_build_helper import parse_xclogs


VERSION = "1.0.0"

HOT_RELOAD_LOG_XCLOG_KEY = "hot_reload_log_xclog.xcactivitylog"


def to_hash_line(line: str):
    return hashlib.sha256(line.encode("utf-8")).hexdigest()


class LogAccumulator:
    def __init__(self, log_accumulator_path):
        self.log_accumulator_path = log_accumulator_path
        self.dirty = False
        self.data = self._read_log_accumulator(log_accumulator_path)

    def set_log(self, file, line: str, st_ctime):
        hash_line = to_hash_line(line)

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

    def clean_xclog_files(self):
        if "parsed_xclog_files" not in self.data:
            return
        self.data["parsed_xclog_files"] = {}

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

    def _clean_not_used_hashes(self):
        if not self.dirty:
            return
        valid_hashes = set(
            hash_line for hash_line in self.data.get("files", {}).values()
        )
        self.data["hashes"] = {
            k: v for k, v in self.data.get("hashes", {}).items() if k in valid_hashes
        }
        self.dirty = False

    def save_log_accumulator(self):
        self._clean_not_used_hashes()
        with open(self.log_accumulator_path, "w") as f:
            json.dump(self.data, f)

    def dump_xclog_file(self, xclog_file):
        self._clean_not_used_hashes()
        lines = list(self.data.get("hashes", {}).values())
        # sort by st_ctime desc
        lines.sort(key=lambda x: -x["st_ctime"])
        lines = "\n\n".join(x["line"] for x in lines)

        try:
            os.unlink(xclog_file)
        except:
            pass

        # gunzip lines
        with gzip.open(xclog_file, "wb") as f:
            f.write(lines.encode("utf-8"))


def cmd_split(s):
    import shlex

    try:
        return shlex.split(s)  # shlex is more right
    except:
        return []


def get_all_xclog_files(xclog_path: pathlib.Path):
    # find all xclog files in xclog_path and sort them by creation date
    xclog_files = list(xclog_path.glob("*.xcactivitylog"))
    xclog_files.sort(key=lambda x: x.stat().st_ctime)
    return [x for x in xclog_files if HOT_RELOAD_LOG_XCLOG_KEY not in x.name]


def extract_all_logs(xclog_files):
    for xclog_file in xclog_files:
        try:
            raw_logs = parse_xclogs(str(xclog_file))
            for line in raw_logs:
                yield (line, xclog_file.stat().st_ctime)
        except:
            pass


def get_files_from_args(args):
    files = []
    for i in range(len(args)):
        if args[i] in ["-primary-file", "-c"]:
            if i + 1 < len(args) and args[i + 1].startswith("/"):
                files.append(args[i + 1])
    return files


def run():
    # pass build_root_path and workspace_path as arguments
    # and this script will parse all xclog files and save only swift-frontend and clang compile logs and put only them as logs
    build_path = sys.argv[1]
    workspace_path = sys.argv[2]

    log_accumulator_path = (
        pathlib.Path(workspace_path)
        / ".vscode"
        / "xcode"
        / "hotreloading_flags_accumulator.json"
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

    already_parsed_files = set(log_accumulator.data.get("parsed_xclog_files", []))

    def parse_new_logs(force_dump):
        nonlocal already_parsed_files
        xclog_files = get_all_xclog_files(xclog_path)
        xclog_files = [f for f in xclog_files if str(f) not in already_parsed_files]

        for line, st_ctime in extract_all_logs(xclog_files):
            parse_line(line, st_ctime)

        already_parsed_files |= set(str(f) for f in xclog_files)
        log_accumulator.set_parsed_xclog_files(xclog_files)
        if force_dump or len(xclog_files) > 0:
            log_accumulator.save_log_accumulator()
            log_accumulator.dump_xclog_file(xclog_path / HOT_RELOAD_LOG_XCLOG_KEY)

    log_accumulator.clean_xclog_files()

    log_manifest_path = xclog_path / "LogStoreManifest.plist"
    last_mtime = log_manifest_path.stat().st_mtime
    parse_new_logs(True)

    # watch for changes in xclog_path and parse new logs

    while True:
        mtime = log_manifest_path.stat().st_mtime
        if mtime != last_mtime:
            # add only new created files, because xcodebuild creates new xclog file for each build
            parse_new_logs(False)
            last_mtime = mtime

        time.sleep(5)


if __name__ == "__main__":
    run()
