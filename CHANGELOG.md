# Change Log

## 0.5.0 - 2024-10-20

### Added

-   Debug UI tests and multiple targets are now supported
-   Support Test Plan

### Fixed

-   Runtime warning communication between lldb and extension is done via fifo
-   Improved stability and bug fixes

## 0.4.0 - 2024-10-20

### Added

-   New breaking change. Removed .env file and moved everything to projectConfiguration.json file.
-   Get rid of old shell commands and replace with ts implementation
-   Own definition provider if sourcekit-lsp fails to provide location (Usually it stops working if there're errors in the file). As a workaround, symbol search works fine as a fallback (similar to Xcode).

### Fixed

-   Improved activation of extension logic
-   buildServer.json file for projects without workspace in was not properly generated
-   Fixed issue with relative path passing to sourcekit-lsp due to not correct workspace folder set
-   Open generated swiftinterface by sourcekit-slp
-   Fixed XCBBuildService in some cases when continueWithErrors environmental variable was set

## 0.3.0 - 2024-10-10

### Added

-   Support Swift Testing framework starting xCode 16.
-   Own lsp client support

### Fixed

-   Test debug session were treated as user cancelled on error
