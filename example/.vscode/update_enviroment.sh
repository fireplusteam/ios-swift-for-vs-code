source '.vscode/.env'

echo "INPUT: $@"

python3 .vscode/update_enviroment.py "$PROJECT_FILE" "$@"