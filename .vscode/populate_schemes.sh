source '.vscode/.env'

python3 .vscode/populate_schemes.py "$PROJECT_FILE" "$PROJECT_SCHEME"

#xcodebuild -showBuildSettings -workspace $PROJECT_FILE -scheme TestVSCode 
# | grep "PRODUCT_BUNDLE_IDENTIFIER"

