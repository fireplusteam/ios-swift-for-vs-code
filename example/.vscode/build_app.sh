source '.vscode/.env'

DESTINATION="id=$DEVICE_ID"

mkdir -p .logs

TYPE=$(if [[ $PROJECT_FILE == *.xcodeproj ]]; then echo "-project"; else echo "-workspace"; fi)

rm .vscode/build.log

if [ $1 == "ALL" ] || [ "$1" == "TARGET" ]; then
    echo "dfs"
    rm -r .vscode/.bundle; xcodebuild $TYPE $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -destination "$DESTINATION" -sdk iphonesimulator -resultBundlePath .vscode/.bundle | tee -a '.logs/build.log' | xcpretty
fi

if [ "$1" == "ALL" ] || [ "$1" == "TESTING" ]; then
    rm -r .vscode/.bundle; xcodebuild $TYPE $PROJECT_FILE -scheme $PROJECT_SCHEME -configuration Debug -destination "$DESTINATION" -sdk iphonesimulator -resultBundlePath .vscode/.bundle build-for-testing | tee -a '.logs/build.log' | xcpretty
fi

# Check the exit status
if [ $? -eq 0 ]; then
    echo "Ok"
else
    python3 .vscode/print_errors.py
    echo "Build failed."
    exit 1
fi

 python3 .vscode/print_errors.py