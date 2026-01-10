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
                "or",
                `osascript -l JavaScript build.js <path_to_workspace> -tapReplaceDialog `,
                "path_to_workspace, scheme can use . as current",
            ].join("\n")
        );
        return;
    }
    var path = argv[0];

    if (argv.length > 1 && argv[1] === "-tapReplaceDialog") {
        waitForReplaceDialog(path);
        return;
    }

    var xcode = Application("Xcode");
    xcode.includeStandardAdditions = true;
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
        let hasScheme = false;
        // wait for scheme to appear
        const originalScheme = scheme;
        for (let cnt = 0; cnt < 12; ++cnt) {
            try {
                scheme = workspace.schemes.byName(originalScheme);
                if (scheme && scheme.exists()) {
                    hasScheme = true;
                    break;
                }
            } catch (e) {
                // ignore
            }
            delay(0.5);
        }
        if (!hasScheme) {
            throw new Error(`scheme ${originalScheme} not exist in workspace ${path}`);
            // console.log("scheme not exist in workspace");
            // //var schemes = workspace.schemes()
            // //console.log(`available is ${Automation.getDisplayString(schemes)}`)
            // return;
        }
        console.log(`active scheme ${scheme.name()}`);
        workspace.activeScheme = scheme;
    }

    console.log("start build");

    workspace.build();

    console.log("build started");
    console.log("active scheme is:");
    // last line should be scheme name for easier parsing
    console.log(workspace.activeScheme.name());
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
    while (xcodeProcess.exists()) {
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
            if (windowsName === undefined || !windowsName.includes(fileName.split(".").at(0))) {
                console.log(`window ${i} name not match file path`);
                continue;
            }
            const sheets = w.sheets();
            if (sheets.length > 0) {
                console.log(`window ${i} has ${sheets.length} sheets`);
                for (let j = 0; j < sheets.length; j++) {
                    const s = sheets[j];
                    console.log(`sheet ${j} name: ${s.name()}`);
                    // find if there's a check box above buttons and set it to true before clicking replace
                    const checkboxes = s.checkboxes();
                    for (let m = 0; m < checkboxes.length; m++) {
                        const c = checkboxes[m];
                        console.log(`checkbox ${m} name: ${c.name()}`);
                        if (c.value() === 0) {
                            c.click();
                            console.log("clicked checkbox to set to true");
                        }
                    }
                    // find replace button and click it
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
