const fs = require('fs');
const readline = require('readline');
const filePath = process.argv[2];

let lastKnownPosition = 0;

function printNewLines() {
    const fileStream = fs.createReadStream(filePath, { start: lastKnownPosition });
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
        console.log(line);
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

// Initial print
printNewLines();
