source '.vscode/.env'

echo "BIND THE FOLLOWING:"
echo $PROJECT_FILE
echo $SCHEME

TYPE=$(if [[ $PROJECT_FILE == *.xcodeproj ]]; then echo "-project"; else echo "-workspace"; fi)

xcode-build-server config -scheme $PROJECT_SCHEME $TYPE $PROJECT_FILE

python3 .vscode/configure_debug.py
