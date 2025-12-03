import { exec } from "child_process";
import path from "path";

export class XCRunHelper {
    private static async getStdOut(command: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            exec(command, (error, stdout) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    public static async getSdkPath(): Promise<string> {
        return this.getStdOut("xcrun --show-sdk-path");
    }

    public static async checkIfXCodeInstalled() {
        return this.getStdOut("xcodebuild -version");
    }

    public static async getClangCompilerPath(): Promise<string> {
        return this.getStdOut("xcrun -f clang");
    }

    public static async sourcekitLSPPath() {
        return this.getStdOut("xcrun -f sourcekit-lsp");
    }
    public static async swiftToolchainPath() {
        const stdout = await this.getStdOut("xcrun --find swift");
        const swift = stdout.trimEnd();
        return path.dirname(path.dirname(swift));
    }

    private static lldbDapPath?: string;
    public static async getLLDBDapPath(): Promise<string> {
        if (this.lldbDapPath === undefined) {
            this.lldbDapPath = await this.getStdOut("xcrun -find lldb-dap");
        }
        return this.lldbDapPath;
    }

    public static isVersionGreaterOrEqual(
        versionA: [string, string, string] | null,
        versionB: [number, number, number]
    ) {
        if (versionA === null) {
            return false;
        }
        for (let i = 0; i < 3; i++) {
            const numA = parseInt(versionA[i], 10);
            const numB = versionB[i];
            if (numA > numB) {
                return true;
            } else if (numA < numB) {
                return false;
            }
        }
        return true;
    }

    public static async swiftToolchainVersion(): Promise<[string, string, string]> {
        const stdout = await this.getStdOut("xcrun swift --version");
        const versionPattern = /swiftlang-([0-9]+)?.([0-9]+)?.([0-9]+)?/g;
        const version = [...stdout.matchAll(versionPattern)]?.[0];
        if (version) {
            return [version[1], version[2], version[3]];
        } else {
            throw Error("swift lang is not determined");
        }
    }

    public static async lldbBinPath() {
        return await this.getStdOut("xcrun --find lldb");
    }

    public static async convertPlistToJson(file: string) {
        return this.getStdOut(`plutil -convert json -o - "${file}"`);
    }
}
