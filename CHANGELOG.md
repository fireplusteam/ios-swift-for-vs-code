# Change Log

## 0.7.7 - 2026-03-20

### Added

- Added better support of HotReloading feature for InjectionNext app or InjectionLite package by caching building compiled flags between sessions as sometimes Xcode build system likes to delete them so you have not to rebuild project to make injection work after. Full instructions in the README.md file.

### Fixed

- lldb logs now display properly in the extension output channel without encoding issues

## 0.7.6 - 2026-03-19

### Fixed

- Disabled lldb-dp workaround for setting breakpoint on break instruction as it can cause side effects

## 0.7.4 - 2026-03-16

### Fixed

- Pass ruby environment variables so in some cases it was failing
- xcodebuild can run sub xcodebuild processes for different build operations, subprocess of xcodebuild is supported as simple proxy without daemon server now, so it should work in more cases and be more stable now.

## 0.7.3 - 2026-03-15

### Added

- Added `env` and `args` support to launch configuration for better debugging experience

### Fixed

- Improved mixed build system mode which utilize Xcode to build project in case if you want to use InjectionNext app from Xcode and VSCode
- Improved lldb script performance

## 0.7.2 - 2026-03-14

### Fixed

- Improve performance of dependency targets resolving algorithm on client side

## 0.7.1 - 2026-03-12

### Fixed

- Improve stability of SWBBuildServiceProxy and fixed some edge cases in message redirecting between original service and the extension

## 0.7.0 - 2026-03-11

### Added

- Completely reworked background indexing logic, now it uses dependency graph of the project to determine which files need to be re-indexed after each build, significantly improving indexing speed and reducing resource consumption for large projects. Full instructions in the README.md file.

## 0.6.13 - 2026-02-26

### Added

- SWBBuildServiceProxy now persistently works in the background and is not terminated after each build which allows to have fast incremental builds like in Xcode and better support of autocompletion for large projects. Full instructions in the README.md file.

### Fixed

- disabled precompiled headers for C++ and Objective-C (PCH) in the build process. Precompiled headers can reduce compilation times by allowing frequently used headers to be compiled once and reused across multiple source files. However this option is causing issues with the C++/Objective-C LSP client on incremental builds, indexing stop working after incremental build with PCH enabled. If you build with Xcode the issue will still be her. You can set **GCC_PRECOMPILE_PREFIX_HEADER=NO** in your project build settings to avoid that issue with that extension when you use Xcode to build.

### Fixed

## 0.6.12 - 2026-02-19

### Added

- **BREAKING CHANGE**: Implemented compiler of SWBBuildServiceProxy as a standalone executable using PyInstaller to simplify installation and usage for end users and remove dependency on the version of this extension itself. Now if enabled it will be rebuild and resigned with a user signing identity on every extension activation to ensure compatibility with the current system and Xcode version and avoid system security issues.

### Fixed

- Added missed Package.swift file to Package.swift generated workspace to ensure proper lsp diagnostics and autocompletion for swift packages

## 0.6.11 - 2026-02-12

### Fixed

- Improved stability of **SWBBuildServiceProxy**, mainly in message redirecting between original service and the extension
- Updated README.md with more detailed instructions on how to enable and use **SWBBuildServiceProxy** feature
- Fixed race condition in xcode-build-server log parsing which could lead to missing lsp diagnostics in some cases

### 0.6.10 - 2026-02-05

- Cosmetic changes to the extension name from "Xcode iOS Swift IDE" to "Swift iOS Xcode IDE" to better reflect its purpose and functionality.

## 0.6.9 - 2026-01-29

### Added

- Reworked project watcher to improve stability and performance while working with large projects, supporting better reaction on file changes for test explorer and autocompletion build triggering

### Fixed

- Package targets now cab be determine under custom path set via `path` property in `Package.swift` manifest file

## 0.6.8 - 2026-01-23

### Added

- Added support of running/debugging tests for all subprojects including swift packages in workspace or project via test explorer or navigating files
- Now you can add targets from swift packages/sub projects/libs to the watcher command task to include them in the build for autocompletion
- Added ability to specify numbers of jobs for watcher build allowing you to balance between system resources usage and build speed for autocompletion
- Added support of lsp diagnostics for swift `Package.swift` files in workspace or project

### Fixed

- Fixed lots of bugs and stability improvements

## 0.6.7 - 2026-01-16

### Added

- Added better support of C/C++/ Objective-C lsp support for header files
- Swift packages as a project dependencies are now available for lsp diagnostics and autocompletion
- Added support of 'swift-format' tool for code formatting via LSP (see [README.md](README.md) for more details)

### Fixed

- Fixed lsp diagnostics for subprojects in workspace if they were added not in root folder

You need to clean build cache after updating to this version to avoid lsp issues

## 0.6.6 - 2026-01-15

### Added

- Added support of folder references in Xcode projects which was added in Xcode 16 but not supported by the extension before
- Added support of build indexes while building via xcodebuild to improve indexing speed but it can increase CPU/RAM usage while building (by default it's enabled, can be disabled via settings)

### Fixed

- minor bugs and stability improvements

## 0.6.5 - 2026-01-11

- Added alt+o to switch between header to source files and vice versa
- Added support of user defined tasks for build/watcher/clean, see [README.md](README.md) file for more information
- Added build system mode: by default it's always xcodebuild, but can be switched to mixedWithXcode which utilize Xcode to build project which can be faster but can run in some issues as it's experimental
- Improved watcher to build all dependent targets to selected target by a user
- Autodetecting targets to build for selected tests to reduce building time

## 0.6.4 - 2026-01-01

- Improved attach debugger to debuggable process reliability
- Better support of Package.swift
- LSP client was not configured right for Package.swift causing issues with autocomplete
- Bug fixes and improved stability

## 0.6.3 - 2025-12-29

### Fixed

- Improved logging system to simplify the identification of issues in a production build
- Better support of workspace generation based on Package.swift as tuist can not generate workspace without .git folder set
- Better macro error parser
- Increase reliability of lldb debugger attaching logic to running tests

## 0.6.2 - 2025-12-25

### Fixed

- Set lldb-dap in server mode to improve performance between debugging session launches
- Throws extension activation error on non MacOS extensions runs as Xcode tools are only available on MacOS

## 0.6.0 - 2025-12-23

### Feature

- Added support of Package.swift via generating the workspace with tuist and and open that workspace with the extension

## 0.5.14 - 2025-12-08

### Fixed

- Test syncing in test explorer
- Parsing testing log (in rare case it could go to infinite loop)
- Launch simulator on running tests because sometimes some tests can require permission which can be resolved only by a user (like Xcode does)
- Improved syncing of async tasks like adding/removing/changing files
- Added parsing of swift macros building errors

## 0.5.13 - 2025-12-03

### Fixed

- Updated lsp to use latest features of swift lsp client like code lenses, etc

## 0.5.12 - 2025-12-01

### Fixed

- Fixed an issue with running a single Swift test.

## 0.5.9 - 2024-11-20

### Fixed

- Build was looped at error

## 0.5.8 - 2024-11-20

### Fixed

- Updated icon

## 0.5.7 - 2024-11-11

### Fixed

- Autocompletion build was triggered on `build` instead of `build-for-testing` in case if test plan was autogenerated by Xcode

## 0.5.6 - 2024-11-11

### Added

- Release an extension as a single bundle which increases the speed of js code execution

## 0.5.4 - 2024-11-8

### Added

- Status Bar to better info a user about selected scheme, configuration, device, test plan
- Added currently selected configuration panel to vscode side bar

## 0.5.3 - 2024-11-7

### Fixed

- Kill sourcekit-lsp as it grows in memory usage rapidly in some cases (this should be fixed in swift 6.1 <https://github.com/swiftlang/sourcekit-lsp/issues/1541>)
- Improved stability and bug fixes

## 0.5.0 - 2024-11-5

### Changed

- Breaking change: `iOS:` renamed to `Xcode:` for all commands

### Added

- Debug UI tests and multiple targets are now supported
- Support Test Plan

### Fixed

- Runtime warning communication between lldb and extension is done via fifo
- Improved stability and bug fixes

## 0.4.0 - 2024-10-20

### Added

- New breaking change. Removed .env file and moved everything to projectConfiguration.json file.
- Get rid of old shell commands and replace with ts implementation
- Own definition provider if sourcekit-lsp fails to provide location (Usually it stops working if there're errors in the file). As a workaround, symbol search works fine as a fallback (similar to Xcode).

### Fixed

- Improved activation of extension logic
- buildServer.json file for projects without workspace in was not properly generated
- Fixed issue with relative path passing to sourcekit-lsp due to not correct workspace folder set
- Open generated swiftinterface by sourcekit-slp
- Fixed XCBBuildService in some cases when continueWithErrors environmental variable was set

## 0.3.0 - 2024-10-10

### Added

- Support Swift Testing framework starting xCode 16.
- Own lsp client support

### Fixed

- Test debug session were treated as user cancelled on error
