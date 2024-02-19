import {
  ExecFileSyncOptionsWithStringEncoding,
  spawn,
  ChildProcess,
} from "child_process";
import { getEnv, getScriptPath, getWorkspacePath } from "./env";
import * as vscode from "vscode";
import { resolve } from "path";

export class Executor {
  private terminal: vscode.Terminal | undefined;
  private writeEmitter: vscode.EventEmitter<string> | undefined;
  private changeNameEmitter: vscode.EventEmitter<string> | undefined;
  private childProc: ChildProcess | undefined;
  private animationInterval: NodeJS.Timeout | undefined;

  public constructor() {}

  createTitleAnimation(terminalId: string) {
    // animation steps
    const steps = ["\\", "|", "/", "-"];
    let currentIndex = 0;
    // start the animation
    const animationInterval = setInterval(() => {
      currentIndex = (currentIndex + 1) % steps.length;
      this.changeNameEmitter?.fire(`${steps[currentIndex]} ${terminalId}`);
    }, 200); // Change this to control animation speed
    return animationInterval;
  }

  private getTerminalName(id: string) {
    const terminalId = `iOS: ${id}`;
    return terminalId;
  }

  private getTerminal(id: string) {
    const terminalId = this.getTerminalName(id);
    clearInterval(this.animationInterval);
    if (this.terminal) {
      this.animationInterval = this.createTitleAnimation(terminalId);
      if (this.terminal.name === terminalId) {
        return this.terminal;
      }
      this.changeNameEmitter?.fire(`${terminalId}`);
      return this.terminal;
    }
    this.writeEmitter = new vscode.EventEmitter<string>();
    this.changeNameEmitter = new vscode.EventEmitter<string>();
    this.animationInterval = this.createTitleAnimation(terminalId);
    const pty: vscode.Pseudoterminal = {
      onDidWrite: this.writeEmitter.event,
      onDidChangeName: this.changeNameEmitter.event,
      open: () => this.writeEmitter?.fire(`\x1b[31${terminalId}\x1b[0m`),
      close: () => {
        this.terminateShell();
      },
    };
    this.terminal = vscode.window.createTerminal({
      name: terminalId,
      pty: pty,
    });
    return this.terminal;
  }

  public terminateShell() {
    clearInterval(this.animationInterval);
    this.childProc?.kill();
    this.terminal?.dispose();
    this.terminal = undefined;
    this.writeEmitter = undefined;
    this.childProc = undefined;
    this.changeNameEmitter = undefined;
  }

  private execShellImp(
    file: string,
    args: ReadonlyArray<string>,
    options: ExecFileSyncOptionsWithStringEncoding
  ) {
    return spawn(file, args, options);
  }

  private dataToPrint(data: string) {
    data = data.replaceAll("\n", "\n\r");
    return data;
  }

  public async execShell(
    commandName: string,
    file: string,
    showTerminal = false,
    args: string[] = []
  ) {
    if (this.childProc !== undefined) {
      return new Promise((resolve) => {
        resolve(false);
      });
    }
    const env = getEnv();
    const envOptions = {
      ...process.env,
      ...env,
    };
    const script = getScriptPath(file);
    const proc = this.execShellImp(script, args, {
      encoding: "utf-8",
      cwd: getWorkspacePath(),
      shell: true,
      env: envOptions,
      stdio: "pipe",
    });
    this.childProc = proc;
    const terminal = this.getTerminal(commandName);
    if (showTerminal) {
      terminal.show();
    }
    this.writeEmitter?.fire(`COMMAND: ${commandName}`);

    proc.stdout?.on("data", (data) => {
      this.writeEmitter?.fire(this.dataToPrint(data.toString()));
    });
    proc.stderr?.on("data", (data) => {
      this.writeEmitter?.fire(this.dataToPrint(data.toString()));
    });

    return new Promise((resolve) => {
      proc.on("exit", (code) => {
        this.childProc = undefined;
        clearInterval(this.animationInterval);

        this.writeEmitter?.fire(
          this.dataToPrint(`${commandName} exits with status code: ${code}\n`)
        );
        if (code !== 0) {
          this.changeNameEmitter?.fire(`❌ ${this.getTerminalName(commandName)}`);
          terminal.show();
        } else {
          this.changeNameEmitter?.fire(`✅ ${this.getTerminalName(commandName)}`);
          resolve(true);
        }
      });
    });
  }
}
