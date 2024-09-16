import path from "path";
import { getScriptPath, getWorkspacePath } from "./env";
import fs from "fs";
import find from "find-process";
import treeKill from "tree-kill";
import psTree from "ps-tree";

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
                treeKill(process.pid, 'SIGKILL', (err) => {
                    resolve(true);
                });
            });
        }
    }
    catch (err) {
        console.log(err);
    }
}

// for some reason kill function doesn't kill all child process in some cases, so we need to do it manually to make sure it's actually killed
export function killAll(pid: number | undefined, signal: string) {
    if (pid === undefined)
        return;
    psTree(pid, function (_, children) {
        treeKill(pid, signal, (err) => {
            if (err != undefined)
                console.log(err);
            if (children === null || children === undefined)
                return;
            for (let item of children) {
                const pid: number = Number(item.PID);
                treeKill(pid, signal, (err) => {
                    if (err != undefined)
                        console.log(err);
                });
            }
        });
    });
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

export function emptyFile(filePath: string, fileName: string) {
    if (fs.existsSync(filePath) === false) {
        fs.mkdirSync(filePath, { recursive: true });
    }
    const fileFullPath = path.join(filePath, fileName);
    fs.writeFileSync(fileFullPath, "", "utf-8");
}

export function deleteLockFile(filePath: string, fileName: string) {
    const lockFilePath = path.join(filePath, fileName + ".lock");
    if (fs.existsSync(lockFilePath)) {
        fs.rmSync(lockFilePath, { force: true, maxRetries: 3 });
    }
}

export function emptyBuildLog() {
    const fileName = ".logs/build.log";
    emptyFile(getWorkspacePath(), fileName);
    deleteLockFile(getWorkspacePath(), fileName)
}

export function emptyTestsLog() {
    const fileName = ".logs/tests.log";
    emptyFile(getWorkspacePath(), fileName);
    deleteLockFile(getWorkspacePath(), fileName)
}

export function emptyAutobuildLog() {
    const fileName = ".logs/autocomplete.log";
    emptyFile(getWorkspacePath(), fileName);
    deleteLockFile(getWorkspacePath(), fileName)
}

export function fileNameFromPath(filePath: string) {
    const list = path.join(filePath).split(path.sep);
    return list[list.length - 1];
}

export function emptyAppLog(deviceId: string) {
    const fileName = `.logs/app_${deviceId}.log`;
    emptyFile(getWorkspacePath(), fileName);
    deleteLockFile(getWorkspacePath(), fileName);
}

export function isFolder(path: string) {
    let stats = fs.statSync(path);
    if (stats.isFile()) {
        return false;
    } else if (stats.isDirectory()) {
        return true;
    } else {
        throw Error("Not a file or directory");
    }
}

export function isFileMoved(oldFile: string, newFile: string) {
    if (oldFile.split(path.sep).slice(0, -1).toString() !== newFile.split(path.sep).slice(0, -1).toString())
        return true;
    return false;
}