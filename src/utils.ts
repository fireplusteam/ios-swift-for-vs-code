import path from "path";
import { getScriptPath, getWorkspacePath } from "./env";
import fs from "fs";
import find from "find-process";
import treeKill from "tree-kill";
import psTree from "ps-tree";
import { lock, unlock } from "lockfile";

export const TimeoutError = new Error("Timed out");
export function promiseWithTimeout<T>(ms: number, promise: () => Promise<T>): Promise<T> {
    // Create a timeout promise that rejects after "ms" milliseconds
    const timeout = new Promise<T>((_, reject) => {
        const id = setTimeout(() => {
            clearTimeout(id);
            reject(TimeoutError);
        }, ms);
    });

    // Returns a race between the timeout and the passed promise
    return Promise.race([promise(), timeout]);
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

export async function asyncLock<T>(path: string, block: () => T) {
    return new Promise<T>((resolve, reject) => {
        lock(getLockFilePath(path), { wait: 100000 }, (error) => {
            if (error) {
                reject(error);
            } else {
                const val = block();
                unlock(getLockFilePath(path), (error) => {
                    resolve(val);
                });
            }
        })
    })
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

export function getLockFilePath(filePath: string) {
    return filePath + ".lock";
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

export function getAppLog(deviceId: string) {
    const fileName = `.logs/app_${deviceId}.log`;
    return fileName;
}

export function emptyAppLog(deviceId: string) {
    const fileName = getAppLog(deviceId);
    emptyFile(getWorkspacePath(), fileName);
    deleteLockFile(getWorkspacePath(), fileName);
}

export function emptyLog(filePath: string) {
    emptyFile(getWorkspacePath(), filePath);
    deleteLockFile(getWorkspacePath(), filePath);
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