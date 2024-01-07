source '.vscode/.env'

echo "INPUT: $@"

python3 .vscode/update_enviroment.py "$@"

if [ "$1" = "-destinationDevice" ]; then

else

fi