const fs = require('fs');
const readline = require('readline');
const filePath = process.argv[2];
const scheme = process.argv[3];

console.log(`PROJECT_SCEME: ${scheme}`)

let lastKnownPosition = 0;

function filterLine(line) {
    if (line.includes("com.apple."))
        return null;
    if (line.includes("   Activity    "))
        return null;

    const parts = line.split(scheme);

    // Extract the portion after "TestVSCode:"
    const result = parts.length > 1 ? parts[1] : line;

    return result;
}

function printNewLines() {
    const fileStream = fs.createReadStream(filePath, { start: lastKnownPosition });
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
        toTrack = filterLine(line);
        if (toTrack !== null) {
            console.log(`${toTrack}\n`);
        }

        lastKnownPosition += line.length + 1; // Add 1 for the newline character
    });

    rl.on('close', () => {
        //console.clear(); // Optional: Clear the console before printing to simulate an update
    });
}

// Watch for changes in the file
fs.watchFile(filePath, (curr, prev) => {
    if (curr.mtime > prev.mtime) {
        printNewLines();
    }
});

function watchFile(filepath, oncreate, ondelete, onchange) {
    var
        fs = require('fs'),
        path = require('path'),
        filedir = path.dirname(filepath),
        filename = path.basename(filepath);

    fs.watch(filedir, function (event, who) {
        if (event === 'rename' && who === filename) {
            if (fs.existsSync(filepath)) {
                oncreate();
            } else {
                ondelete();
            }
        } else if (event == 'change' && who == filename) {
            onchange();
        }
    })
}

watchFile('.vscode/log.changed', function () { }, function () { }, function () {
    console.clear();
    lastKnownPosition = 0;
    console.log('RELAUNCHING APPLICATION...');
})

// Initial print
printNewLines();
