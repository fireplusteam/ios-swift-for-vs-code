
source '.vscode/.env'
DESTINATION="platform=$PLATFORM,OS=$PLATFORM_OS,name=$DEVICE_NAME"
xcodebuild test -workspace $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -sdk iphonesimulator -destination "$DESTINATION" | tee '.vscode/tests.log'

echo 'Your testing results are in: .vscode/tests.log'
echo 'To open xcresult in Xcode perform: open -a XCode /path_to_your_testing.xcresult'