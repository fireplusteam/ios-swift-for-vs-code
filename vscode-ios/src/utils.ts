
export function getLastLine(stdout: string) {
    stdout = stdout.trim();
    const lines = stdout.split("\n");
    return lines[lines.length - 1];
}