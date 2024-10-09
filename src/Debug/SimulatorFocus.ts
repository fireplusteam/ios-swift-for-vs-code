import { execSync } from "child_process";
import { CommandContext } from "../CommandManagement/CommandContext";
import { Platform } from "../env";

export class SimulatorFocus {
    private context: CommandContext;
    private platform?: Platform;
    private deviceID?: string;
    private productName?: string;

    constructor(context: CommandContext) {
        this.context = context;
    }

    async init() {
        this.platform = await this.context.projectSettingsProvider.projectEnv.platform;
        this.deviceID = await this.context.projectSettingsProvider.projectEnv.debugDeviceID;
        this.productName = await this.context.projectSettingsProvider.projectEnv.productName;
    }

    focus() {
        if (
            this.productName === undefined ||
            this.platform === undefined ||
            this.deviceID === undefined
        ) {
            return;
        }

        try {
            if (this.platform === Platform.macOS) {
                // eslint-disable-next-line no-useless-escape
                execSync(`osascript -e \"tell application \\"${this.productName}\\" to activate\"`);
            } else {
                execSync(`open -a Simulator --args -CurrentDeviceUDID ${this.deviceID}`);
            }
        } catch (error) {
            console.log(`Simulator was not focused. Error: ${error}`);
        }
    }
}
