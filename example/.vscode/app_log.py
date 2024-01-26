import os
import time
import sys
import helper

class AppLogger:
    def __init__(self, file_path, project_scheme, printer = print) -> None:
        self.file_path = file_path
        self.project_scheme = project_scheme
        self.last_known_position = 0
        self.printer = printer
    
    
    def filter_line(self, line):
        return line


    def print_new_lines(self):
        try:
            with helper.FileLock(self.file_path + '.lock'):
                with open(self.file_path, 'r') as file:
                    file.seek(self.last_known_position)
                    try: 
                        for line in file:
                            to_track = self.filter_line(line.strip())
                            if to_track:
                                to_track = to_track.splitlines()
                                for line in to_track:
                                    self.printer(f"{line}")

                            self.last_known_position += len(line) + 1  # Add 1 for the newline character
                            sys.stdout.flush()
                    except Exception as e:
                        self.printer(f"Exception reading file: {str(e)}")
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
            if not helper.is_debug_session_valid(start_time):
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
    project_scheme = os.environ.get('PROJECT_SCHEME')
    
    logger = AppLogger(file_path, project_scheme)
    # Watch for changes in the file
    logger.watch_app_log()