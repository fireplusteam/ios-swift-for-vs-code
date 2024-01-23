source '.vscode/.env'

DESTINATION="id=$DEVICE_ID"

mkdir -p .logs

TYPE=$(if [[ $PROJECT_FILE == *.xcodeproj ]]; then echo "-project"; else echo "-workspace"; fi)

BUNDLE=".vscode/.bundle"

rm -r "$BUNDLE"

SELECTED_FILE=$1

SCHEME_SCRIPT=$(python3 <<EOF
import sys
sys.path.insert(0, '.vscode')
import helper
import xcutil

scheme = xcutil.get_scheme_by_file_name("$PROJECT_FILE", "$SELECTED_FILE")
print(scheme)

EOF
)

SCHEME=$(echo "$SCHEME_SCRIPT" | tail -n 1)

SCHEME_VALUE=$(echo "$SCHEME")

if [ "$SCHEME_VALUE" == "None" ]; then
    echo "No scheme is found for file: $SELECTED_FILE"
    exit 0
fi

rm .logs/build.log

echo "Path to the built app: ${SCHEME_VALUE}"

xcodebuild $TYPE $PROJECT_FILE -scheme $SCHEME -configuration Debug -destination "$DESTINATION" -sdk iphonesimulator -resultBundlePath "$BUNDLE" build | tee -a '.logs/build.log'

python3 .vscode/print_errors.py