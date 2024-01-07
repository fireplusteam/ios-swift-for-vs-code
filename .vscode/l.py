import os
import time
import sys

file_path = sys.argv[1]
project_scheme = os.environ.get('PROJECT_SCHEME')

last_known_position = 0

def filter_line(line):
    return line


def print_new_lines():
    global last_known_position
    with open(file_path, 'r') as file:
        file.seek(last_known_position)
        for line in file:
            to_track = filter_line(line.strip())
            if to_track:
                print(f"{to_track}")

            last_known_position += len(line) + 1  # Add 1 for the newline character

        sys.stdout.flush()


# Watch for changes in the file
def watch_file(filepath, on_delete, on_change):
    filedir, filename = os.path.split(filepath)

    stat = os.path.getmtime(filepath)
    while True:
        print_new_lines()
        time.sleep(1)
        try:
            if stat < os.path.getmtime(filepath):
                stat = os.path.getmtime(filepath)
                on_change()
        except FileNotFoundError:
            on_delete()
            continue


def on_delete():
    print(f'Log is deleted for Application {project_scheme}')


def on_change():
    global last_known_position
    os.environ['TERM'] = 'xterm'  # Set the TERM variable to a reasonable default
    os.system('clear')  # Clear the console before printing to simulate an update
    last_known_position = 0
    print(f'RELAUNCHING {project_scheme} APPLICATION...')


# Watch for changes in the file
watch_file('.vscode/log.changed', on_delete, on_change)