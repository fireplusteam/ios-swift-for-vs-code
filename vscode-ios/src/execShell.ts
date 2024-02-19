import {
  exec,
  execFile,
  execFileSync,
  ExecFileSyncOptionsWithStringEncoding,
  spawnSync,
  spawn,
} from "child_process";
import { cwd } from "process";
import { getEnv, getScriptPath, getWorkspacePath } from "./env";
import * as vscode from "vscode";
import { write } from "fs";

export class Executor {
  private terminal: vscode.Terminal | undefined;
  private writeEmitter: vscode.EventEmitter<string> | undefined;

  public constructor() {}

  private findTerminal(name: string) {
    return (
      vscode.window.terminals.find((term) => {
        return term.name === name;
      }) || null
    );
  }

  private getTerminal(id: string) {
    const terminalId = `iOS: ${id}`;
    if (this.terminal) {
      if (this.terminal.name === terminalId) {
        return this.terminal;
      }
      this.terminal.dispose();
    }
    this.writeEmitter = new vscode.EventEmitter<string>();
    const pty: vscode.Pseudoterminal = {
      onDidWrite: this.writeEmitter.event,
      open: () => this.writeEmitter?.fire(`\x1b[31${terminalId}d\x1b[0m`),
      close: () => {},
    };
    this.terminal = vscode.window.createTerminal({ name: terminalId, pty: pty });
    return this.terminal;
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

  public execShellSync(
    commandName: string,
    file: string,
    args: ReadonlyArray<string> = []
  ) {
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
    const terminal = this.getTerminal(commandName);
    this.writeEmitter?.fire(`COMMAND: ${commandName}`);

    proc.stdout?.on("data",  (data) => {
      this.writeEmitter?.fire(this.dataToPrint(data.toString()));
    });
    proc.stderr?.on("data",  (data) => {
      this.writeEmitter?.fire(this.dataToPrint(data.toString()));
    });
    proc.on("exit",  (code) => {
      this.writeEmitter?.fire(this.dataToPrint(`${commandName} exits with status code: ${code}\n`));
      if (code !== 0) {
        terminal.show();
      }
    });
  }
}
