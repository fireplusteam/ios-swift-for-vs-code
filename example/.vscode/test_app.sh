source '.vscode/.env'

DESTINATION="id=$DEVICE_ID"

mkdir -p .logs

TYPE=$(if [[ $PROJECT_FILE == *.xcodeproj ]]; then echo "-project"; else echo "-workspace"; fi)

export NSUnbufferedIO=YES
export XCT_PARALLEL_DEVICE_DESTINATIONS=1

rm -r .bundle.xcresult

rm -r .vscode/.bundle; xcodebuild $TYPE $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -sdk iphonesimulator -destination "$DESTINATION" -resultBundlePath .vscode/.bundle test | tee '.logs/tests.log' | xcbeautify

# Open Results
REPORT_PATH='/.vscode/bundle.xcresult'
LOCAL_PATH=$(pwd)

URL='file://'$LOCAL_PATH$REPORT_PATH
URL=${URL// /%20}

echo "Test HTML Report: $URL"
#open $URL

# print errors
# Check the exit status
python3 .vscode/print_errors.py

echo 'Your testing results are in: .logs/tests.log'
echo 'To open xcresult in Xcode perform: open -a XCode /path_to_your_testing.xcresult'