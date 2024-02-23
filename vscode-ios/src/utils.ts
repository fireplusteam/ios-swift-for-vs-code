import { resolve } from "path";
import { getScriptPath, getWorkspacePath } from "./env";

var find = require("find-process");
var kill = require("tree-kill");

export async function killSpawnLaunchedProcesses() {
    try {
        let processList = await find("name", `${getScriptPath()}/launch.py`);
        for (let process of processList) {
            console.log(process);
            //const cmd: string = process.cmd;
            /*await new Promise((resolve) => {
                kill(process.pid, 'SIGKILL', (err: any) => {
                    resolve(true);
                });
            });*/
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