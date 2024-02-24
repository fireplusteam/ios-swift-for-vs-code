import { getScriptPath, getWorkspacePath } from "./env";

var find = require("find-process");
var kill = require("tree-kill");

export async function killSpawnLaunchedProcesses(sessionId: string) {
    try {
        let processList = await find("name", `${getScriptPath()}/launch.py`);
        for (let process of processList) {
            console.log(`process is still running ${process.cmd}`);
            const cmd = process.cmd as string;
            if (cmd.indexOf(sessionId) === -1) {
                continue;
            }
            await new Promise((resolve) => {
                kill(process.pid, 'SIGKILL', (err: any) => {
                    resolve(true);
                });
            });
        }
    }
    catch(err) {
        console.log(err);
    }
}

export function getSessionId(key: String) {
    const path = `${getWorkspacePath()} ${key}`;
    return Buffer.from(path, 'utf-8').toString('base64');
}

export function getLastLine(stdout: string) {
    stdout = stdout.trim();
    const lines = stdout.split("\n");
    return lines[lines.length - 1];
}