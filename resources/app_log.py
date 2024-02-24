import os
import time
import sys
import helper

class AppLogger:
    def __init__(self, file_path, project_scheme, session_id, printer = print) -> None:
        self.file_path = file_path
        self.project_scheme = project_scheme
        self.last_known_position = 0
        self.printer = printer
        self.enabled = True
        self.session_id = session_id
    
    
    def print_new_lines(self):
        try:
            with helper.FileLock(self.file_path + '.lock'):
                with open(self.file_path, 'r') as file:
                    file_size = os.path.getsize(self.file_path)
                    
                    if self.last_known_position < file_size:
                        file.seek(self.last_known_position)
                    else:
                        return

                    try: 
                        line = file.buffer.read()
                        if self.enabled:
                            line_str = line.decode()
                            self.printer(line_str, end='')

                        self.last_known_position += len(line)  # Add 1 for the newline character
                    except Exception as e:
                        self.printer(f"Exception reading file: {str(e)}, position: ${self.last_known_position}", end='')
                        self.last_known_position += 1
        except: # no such file
            pass


    # Watch for changes in the file
    def _watch_file(self, filepath, start_time, on_delete, on_change):
        #filedir, filename = os.path.split(filepath)
        try:
            stat = os.path.getmtime(filepath)
        except:
            stat = time.time()

        while True:
            self.print_new_lines()
            if not helper.is_debug_session_valid(self.session_id, start_time):
                return
            time.sleep(1)
            try:
                if stat < os.path.getmtime(filepath):
                    stat = os.path.getmtime(filepath)
                    on_change()
            except FileNotFoundError:
                on_delete()
                continue
            
    
    def watch_app_log(self, file_path = '.logs/log.changed', start_time = time.time()):
        self._watch_file(file_path, start_time, self.on_delete, self.on_change)


    def on_delete(self):
        self.printer(f'Log is deleted for Application {self.project_scheme}')


    def on_change(self):
        os.environ['TERM'] = 'xterm'  # Set the TERM variable to a reasonable default
        os.system('clear')  # Clear the console before printing to simulate an update
        self.last_known_position = 0
        self.printer(f'RELAUNCHING {self.project_scheme} APPLICATION...')


if __name__ == "__main__":
    file_path = sys.argv[1]
    session_id = sys.argv[2]
    project_scheme = os.environ.get('PROJECT_SCHEME')
    
    logger = AppLogger(file_path, project_scheme, session_id)
    # Watch for changes in the file
    logger.watch_app_log()