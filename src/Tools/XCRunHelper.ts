import { exec } from "child_process";

export class XCRunHelper {

    private static async getStdOut(command: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            exec(command, (error, stdout) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout.trim());
                }
            })
        });
    }

    public static async getSdkPath(): Promise<string> {
        return this.getStdOut("xcrun --show-sdk-path");
    }

    public static async getClangCompilerPath(): Promise<string> {
        return this.getStdOut("xcrun -f clang");
    }

    public static async getLLDBDapPath(): Promise<string> {
        return this.getStdOut("xcrun -find lldb-dap");
    }

    public static async swiftToolchainVersion(): Promise<[string, string, string]> {
        const stdout = await this.getStdOut("xcrun swift --version");
        const versionPattern = /swiftlang-([0-9]+)?.([0-9]+)?.([0-9]+)?/g;
        const version = [...stdout.matchAll(versionPattern)]?.[0];
        if (version) {
            return ([version[1], version[2], version[3]]);
        } else {
            throw new Error("swift lang is not determined");
        }
    }
}