#!/usr/bin/env python3
import time
import sys
import helper
import os
import lldb
import attach_lldb
import json


# def perform_debugger_command(debugger: lldb.SBDebugger, command: str) -> bool:
#     """
#     Executes a command in the LLDB debugger and logs the result.

#     :param debugger: debugger instance
#     :param command: The command to execute.
#     :return: The result of the command execution.
#     """
#     if isinstance(debugger, lldb.SBTarget):
#         debugger = debugger.GetDebugger()
#     attach_lldb.log_message(f"Result Command: {str(command)}, time: {time.time()}")
#     debugger = lldb.debugger
#     try:
#         interpreter = debugger.GetCommandInterpreter()
#         return_object = lldb.SBCommandReturnObject()
#         interpreter.HandleCommand(command, return_object)
#         return return_object.Succeeded()
#     except Exception as e:
#         return False


class AppLogger:
    def __init__(self, file_path, printer=print) -> None:
        self.file_path = file_path
        self.enabled = True
        self.printer = printer

    def _is_code_lldb(self):
        return os.environ.get("LLDB_PROVIDER", "") == "code_lldb"

    def print_new_lines(self, file):
        try:
            while True:
                try:
                    if not "LLDB_PROVIDER" in os.environ:
                        break
                    line = helper.binary_readline(file, b"\n")
                    if not line or line == b"":
                        break
                    if not line.endswith(b"\n"):
                        break

                    if self.enabled:
                        if self._is_code_lldb():
                            line = line.decode(encoding="utf-8", errors="replace")
                            self.printer(line, end="", flush=True)
                        else:
                            if self._debugger:
                                body = {
                                    "output": line.decode(
                                        encoding="utf-8", errors="replace"
                                    )
                                }
                                body = json.dumps(body)
                                attach_lldb.perform_debugger_command(
                                    self._debugger,
                                    f"lldb-dap send-event output '{body}'",
                                )
                            else:
                                sys.stdout.buffer.write(line)
                                sys.stdout.flush()
                except:
                    # cut utf-8 characters as code lldb console can not print such characters and generates an error
                    if self.enabled:
                        if self._is_code_lldb():
                            to_print = ""
                            for i in line:
                                if ord(i) < 128:
                                    to_print += i
                                else:
                                    to_print += "?"
                            self.printer(to_print, end="", flush=True)

        except:  # no such file
            pass

    def _watch_file(self, file):
        while True:
            self.print_new_lines(file)
            time.sleep(1)

    def watch_app_log(self, debugger):
        with open(self.file_path, "rb") as file:
            self._debugger = debugger
            self._watch_file(file)


if __name__ == "__main__":
    file_path = sys.argv[1]
    session_id = sys.argv[2]

    logger = AppLogger(file_path)
    # Watch for changes in the file
    logger.watch_app_log(None)
