
source '.vscode/.env'

DESTINATION="id=$DEVICE_ID"

mkdir -p .logs

TYPE=$(if [[ $PROJECT_FILE == *.xcodeproj ]]; then echo "-project"; else echo "-workspace"; fi)

#export NSUnbufferedIO=YES
#export XCT_PARALLEL_DEVICE_DESTINATIONS=1

rm .vscode/.bundle; xcodebuild test $TYPE $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -sdk iphonesimulator -destination "$DESTINATION" -resultBundlePath .vscode/.bundle | tee '.logs/tests.log'

# Check the exit status
python3 .vscode/print_errors.py

echo 'Your testing results are in: .logs/tests.log'
echo 'To open xcresult in Xcode perform: open -a XCode /path_to_your_testing.xcresult'

