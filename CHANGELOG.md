# Change Log

## 0.4.0 - 2024-10-20

### Added

-   New breaking change. Removed .env file and moved everything to projectConfiguration.json file.
-   Get rid of old shell commands and replace with ts implementation

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
