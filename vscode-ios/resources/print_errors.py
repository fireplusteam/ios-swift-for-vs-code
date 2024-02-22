import sys
import os

file_path = ".logs/build.log"

problem_matcher = False
if len(sys.argv) > 1:
    if sys.argv[1] == '-problemMatcher':
        problem_matcher = True;
    else:
        file_path = sys.argv[1]

if not os.path.exists(file_path):
    lines = []
else:
    with open(file_path, 'r') as file:
        lines = file.readlines()

class Color:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'

error_pattern = "error:"
end_error_pattern = "^"

number_of_errors = 0

def filter_lines(lines):
    global number_of_errors
    global file_path
    filtered = []
    is_inside_error = False
    added_followup_lines = 0
    log_pos = -1
    for indx, line in enumerate(lines):
        if is_inside_error:
            if end_error_pattern in line:
                is_inside_error = False
                error_line = "\t" + line.rstrip()
                error_line += f"\t->\t{file_path}:{log_pos + 1}"
                filtered.append(error_line)
            elif len(line.strip()) > 0 and added_followup_lines < 2:
                added_followup_lines += 1
                error_line = "\t" + line.rstrip()
                if added_followup_lines > 1:
                    error_line += f"\t->\t{file_path}:{log_pos + 1}"
                filtered.append(error_line)

        if error_pattern in line:
            if len(line.strip()) > 0:
                filtered.append(("❌ " if not problem_matcher else " ") + line.strip())
            number_of_errors += 1
            is_inside_error = True
            log_pos = indx
            added_followup_lines = 0
    return filtered

lines = filter_lines(lines)

output = f"{Color.FAIL}LIST OF ERRORS: {number_of_errors}{Color.ENDC}\n"
pure_output = "LIST OF ERRORS:\n"
for line in lines:
    i = 0
    if end_error_pattern in line:
        output += f"{Color.OKGREEN}{line}{Color.ENDC}"
        pure_output += line
    else:
        items = line.split(error_pattern)

        for i in range(0, len(items)):
            if i == 0 and len(items) > 1:
                output += f"{Color.HEADER}{items[i]}{Color.ENDC}"
                pure_output += items[i]
            else:
                output += items[i]
                pure_output += items[i]
            if i != len(items) - 1:
                output += f"{Color.FAIL}{error_pattern}{Color.ENDC}"
                pure_output += error_pattern

    pure_output += "\n"
    output += "\n"

if len(lines) > 0:
    with open(".logs/errors.log", 'w') as file:
        file.write(pure_output)
        
    if (problem_matcher):
        print(pure_output)
        sys.stdout.flush();
        exit(0)
    else:
        print(output)
    
    sys.stdout.flush();
    exit(1)
else:
    pure_output = "No errors!"
    with open(".logs/errors.log", 'w') as file:
        file.write(pure_output)
    