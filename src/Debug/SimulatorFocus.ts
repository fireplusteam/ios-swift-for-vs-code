import { execSync } from "child_process";
import { DeviceID, ProjectEnv } from "../env";
import path from "path";

export class SimulatorFocus {
    private deviceID?: DeviceID;
    private productName?: string;

    constructor() {}

    async init(projectEnv: ProjectEnv, processExe: string) {
        this.deviceID = await projectEnv.debugDeviceID;
        this.productName = processExe.split(path.sep).at(0);
        if (this.productName === undefined) {
            this.productName = await projectEnv.productName;
        } else if (this.productName.endsWith(".app")) {
            this.productName = this.productName.slice(0, -".app".length);
        }
    }

    focus() {
        if (this.productName === undefined || this.deviceID === undefined) {
            return;
        }

        try {
            if (this.deviceID?.platform === "macOS") {
                // eslint-disable-next-line no-useless-escape
                execSync(`osascript -e \"tell application \\"${this.productName}\\" to activate\"`);
            } else {
                execSync(`open -a Simulator --args -CurrentDeviceUDID ${this.deviceID.id}`);
            }
        } catch (error) {
            console.log(`Simulator was not focused. Error: ${error}`);
        }
    }
}
