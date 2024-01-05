PROJECT_FILE="$1"
SCHEME="$2"

echo "BIND THE FOLLOWING:"
echo $PROJECT_FILE
echo $SCHEME

xcode-build-server config -scheme $SCHEME -workspace $PROJECT_FILE
