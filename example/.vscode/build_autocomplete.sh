PROJECT_FILE="$1"
SCHEME="$2"

xcode-build-server config -scheme $SCHEME -workspace $PROJECT_FILE
