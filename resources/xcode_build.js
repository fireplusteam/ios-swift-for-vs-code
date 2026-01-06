#!/usr/bin/env osascript -l JavaScript
// exclude from eslint checking as it's JXA script
/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
/* eslint-disable no-var */
/* eslint-disable prefer-const */

// this need xcode call authorized
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function run(argv) {
    if (argv.length < 1 || argv[0] === "-h" || argv[0] === "--help") {
        console.log(
            [
                `Usage: osascript -l JavaScript build.js <path_to_workspace> [scheme]`,
                "",
                "path_to_workspace, scheme can use . as current",
            ].join("\n")
        );
        return;
    }
    var xcode = Application("Xcode");
    xcode.includeStandardAdditions = true;
    var path = argv[0];
    var workspace;
    if (path === ".") {
        console.log("get active workspace");
        workspace = xcode.activeWorkspaceDocument();
        if (!workspace) {
            console.log("no active workspace, choose one with path or in xcode");
        }
    } else {
        console.log(`open workspace ${path}`);
        var pathURL = $.NSURL.fileURLWithPath(path);
        workspace = xcode.open(pathURL.path.UTF8String);

        // ctrl-c can break
        for (var i = 0; i < 100; i++) {
            if (workspace.loaded()) {
                break;
            }
            delay(1);
        }
        if (i === 3) {
            console.log(`workspace loaded timedout, try again later`);
            ObjC.import("stdlib"); // for exit
            $.exit(16);
        }
    }
    var scheme = argv[1];
    if (scheme === "." || !scheme) {
        // seems no need to use scheme further
        // console.log("get active scheme")
        scheme = workspace.activeScheme();
        console.log(`active scheme is ${scheme.name()}`);
    } else {
        console.log(`get scheme by ${scheme}`);
        scheme = workspace.schemes.byName(scheme);
        if (!scheme.exists()) {
            console.log("scheme not exist in workspace");
            //var schemes = workspace.schemes()
            //console.log(`available is ${Automation.getDisplayString(schemes)}`)
            return;
        }
        console.log(`active scheme ${scheme.name()}`);
        workspace.activeScheme = scheme;
    }

    console.log("start build");

    workspace.build();

    console.log("build started");

    waitForReplaceDialog(path);
    // TODO: query build status //
}

function waitForReplaceDialog(filePath) {
    var se = Application("System Events");
    se.includeStandardAdditions = true;

    var xcodeProcess = se.processes.whose({ name: "Xcode" })[0];
    if (!xcodeProcess.exists()) {
        console.log("Xcode process not exist");
        return;
    }
    // eslint-disable-next-line no-constant-condition
    const fileName = filePath.toLowerCase().split("/").at(-1);
    console.log(`file name to match: ${fileName}`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
        // check if it's killed
        if (!xcodeProcess.exists()) {
            console.log("Xcode process not exist, seems killed");
            return;
        }
        console.log("wait replace dialog", xcodeProcess.name());
        const windows = xcodeProcess.windows();
        if (windows.length === 0) {
            delay(1);
            continue;
        }
        console.log(`found ${windows.length} windows`);
        for (let i = 0; i < windows.length; i++) {
            const w = windows[i];
            console.log(`window ${i} name: ${w.name()}`);
            const windowsName = w.name().toLowerCase();
            if (windowsName === undefined || !windowsName.includes(fileName)) {
                console.log(`window ${i} name not match file path`);
                continue;
            }
            const sheets = w.sheets();
            if (sheets.length > 0) {
                console.log(`window ${i} has ${sheets.length} sheets`);
                for (let j = 0; j < sheets.length; j++) {
                    const s = sheets[j];
                    console.log(`sheet ${j} name: ${s.name()}`);
                    const buttons = s.buttons();
                    for (let k = 0; k < buttons.length; k++) {
                        const b = buttons[k];
                        if (b.name() === "Replace") {
                            b.click();
                            console.log("clicked replace button in sheet");
                            return;
                        }
                    }
                }
                continue;
            }
        }
        delay(1);
    }
}
