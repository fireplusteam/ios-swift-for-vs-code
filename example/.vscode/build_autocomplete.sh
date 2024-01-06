source '.vscode/.env'

echo "BIND THE FOLLOWING:"
echo $PROJECT_FILE
echo $SCHEME

xcode-build-server config -scheme $PROJECT_SCHEME -workspace $PROJECT_FILE
