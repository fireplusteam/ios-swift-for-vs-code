
source '.vscode/.env'

DESTINATION="id=$DEVICE_ID"

mkdir -p .logs

TYPE=$(if [[ $PROJECT_FILE == *.xcodeproj ]]; then echo "-project"; else echo "-workspace"; fi)

xcodebuild test $TYPE $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -sdk iphonesimulator -destination "$DESTINATION" | tee '.logs/tests.log'

echo 'Your testing results are in: .logs/tests.log'
echo 'To open xcresult in Xcode perform: open -a XCode /path_to_your_testing.xcresult'