## How to build/install extension from a repo

Open terminal to install required libraries (Also make sure you've installed Xcode, xcbeautify, xcodeproj):

-   install **pyinstaller** and **psutil** (needed to build Xcode proxy build service)

```bash
pip install pyinstaller
pip install psutil
```

-   install **npm**

```bash
brew install node
```

-   clone git repo and update submodules:

```bash
git clone https://github.com/fireplusteam/ios_vs_code.git
git submodule update --init --recursive
```

-   install vsce package

```bash
brew install vsce
```

-   1. Open Visual Studio Code.
    2. Press **Cmd+Shift+P** to open the Command Palette.
    3. Type: **Shell Command: Install 'code' command in PATH**.

-   navigate to repo folder in your terminal and run:

```bash
./make.sh
```

If everything configured right, the extension should be built and installed to vs code automatically.
