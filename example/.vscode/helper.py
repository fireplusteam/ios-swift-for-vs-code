
file_path = '.vscode/.env'

def get_env_list():
    with open(file_path, 'r') as file:
        key_value = [line.strip().split('=') for line in file]
    return dict(key_value)

def safe_env_list(list):
    with open(file_path, 'w') as file:
        for key, value in list.items():
            file.write(key + "=" + value + "\n")

if __name__ == "__main__":
    print("ok")