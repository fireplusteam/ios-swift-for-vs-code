#!/usr/bin/env python3
import time
import sys
import helper


class AppLogger:
    def __init__(self, file_path, printer=print) -> None:
        self.file_path = file_path
        self.printer = printer
        self.enabled = True

    def print_new_lines(self, file):
        try:
            while True:
                try:
                    line = helper.binary_readline(file, b"\n")
                    if not line:
                        break
                    if not line.endswith(b"\n"):
                        break

                    if self.enabled:
                        line = line.decode(errors="replace")
                        self.printer(line, end="", flush=True)
                except:
                    # cut utf-8 characters as code lldb console can not print such characters and generates an error
                    if self.enabled:
                        to_print = ""
                        for i in line:
                            if ord(i) < 128:
                                to_print += i
                            else:
                                to_print += "?"
                        self.printer(to_print, end="")

        except:  # no such file
            pass

    def _watch_file(self, file):
        while True:
            self.print_new_lines(file)
            time.sleep(1)

    def watch_app_log(self):
        with open(self.file_path, "rb") as file:
            self._watch_file(file)


if __name__ == "__main__":
    file_path = sys.argv[1]
    session_id = sys.argv[2]

    logger = AppLogger(file_path)
    # Watch for changes in the file
    logger.watch_app_log()
