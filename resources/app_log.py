import os
import time
import sys
import helper

class AppLogger:
    def __init__(self, file_path, session_id, printer = print) -> None:
        self.file_path = file_path
        self.last_known_position = 0
        self.printer = printer
        self.enabled = True
        self.session_id = session_id
    
    
    def print_new_lines(self):
        try:
            with helper.FileLock(self.file_path + '.lock'):
                with open(self.file_path, 'rb') as file:
                    file_size = os.path.getsize(self.file_path)
                    
                    if self.last_known_position < file_size:
                        file.seek(self.last_known_position)
                    else:
                        return
                    
                    while True:
                        try: 
                            line = helper.binary_readline(file, b'\n')
                            if not line:
                                return
                            if not line.endswith(b'\n'):
                                return
                            
                            if self.enabled:
                                line = line.decode(errors="replace")
                                self.printer(line, end='')
                        except:
                            # cut utf-8 characters as code lldb console can not print such characters and generates an error
                            if self.enabled:
                                to_print = ""
                                for i in line:
                                    if ord(i) < 128:
                                        to_print += i
                                    else:
                                        to_print += '?'
                                self.printer(to_print, end='')

                        self.last_known_position = file.tell()

        except: # no such file
            pass


    def _watch_file(self):
        while True:
            self.print_new_lines()
            if not helper.is_debug_session_valid(self.session_id):
                return
            time.sleep(1)
            
    
    def watch_app_log(self):
        self._watch_file()


if __name__ == "__main__":
    file_path = sys.argv[1]
    session_id = sys.argv[2]
    project_scheme = os.environ.get('PROJECT_SCHEME')
    
    logger = AppLogger(file_path, project_scheme, session_id)
    # Watch for changes in the file
    logger.watch_app_log()