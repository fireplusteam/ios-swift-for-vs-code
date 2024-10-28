import { execSync } from "child_process";
import { CommandContext } from "../CommandManagement/CommandContext";
import { DeviceID } from "../env";

export class SimulatorFocus {
    private context: CommandContext;
    private deviceID?: DeviceID;
    private productName?: string;

    constructor(context: CommandContext) {
        this.context = context;
    }

    async init() {
        this.deviceID = await this.context.projectEnv.debugDeviceID;
        this.productName = await this.context.projectEnv.productName;
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
