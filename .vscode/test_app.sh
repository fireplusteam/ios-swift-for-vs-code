source '.vscode/.env'

DESTINATION="id=$DEVICE_ID"

mkdir -p .logs

rm .logs/build.log

TYPE=$(if [[ $PROJECT_FILE == *.xcodeproj ]]; then echo "-project"; else echo "-workspace"; fi)

export NSUnbufferedIO=YES
export XCT_PARALLEL_DEVICE_DESTINATIONS=1

rm -r .bundle.xcresult

rm -r .vscode/.bundle; xcodebuild $TYPE $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -sdk iphonesimulator -destination "$DESTINATION" -resultBundlePath .vscode/.bundle test | tee '.logs/build.log' | xcbeautify

# Open Results
REPORT_PATH='/.vscode/.bundle.xcresult'
LOCAL_PATH=$(pwd)

URL=$LOCAL_PATH$REPORT_PATH
URL=${URL// /%20}

echo "Test  Report: $URL"
open -a XCode  "file://$URL"

# print errors
# Check the exit status
python3 .vscode/print_errors.py

echo 'Your testing results are in: .logs/build.log'