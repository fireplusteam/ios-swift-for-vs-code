import sys

with open(".logs/build.log") as file:
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

def filter_lines(lines):
    filtered = []
    is_inside_error = False
    added_followup_lines = 0
    for line in lines:
        if is_inside_error:
            if end_error_pattern in line:
                is_inside_error = False
                filtered.append("\t" + line.rstrip())
            elif len(line.strip()) > 0 and added_followup_lines < 1:
                added_followup_lines += 1
                filtered.append("\t" + line.rstrip())

        if error_pattern in line:
            if len(line.strip()) > 0:
                filtered.append("❌ " + line.strip())
            is_inside_error = True
            added_followup_lines = 0
    return filtered

lines = filter_lines(lines)

output = f"{Color.FAIL}LIST OF ERRORS: {Color.ENDC}\n"
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

    output += "\n"

if len(lines) > 0:
    print(output)

    with open(".logs/errors.log", 'w') as file:
        file.write(pure_output)
    
    sys.stdout.flush()

    exit(1)
else:
    pure_output = "No errors!"
    with open(".logs/errors.log", 'w') as file:
        file.write(pure_output)
    