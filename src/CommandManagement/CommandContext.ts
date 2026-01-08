import * as vscode from "vscode";
import {
    Executor,
    ExecutorMode,
    ShellCommand,
    ShellExec,
    ShellFileScript,
    ShellResult,
} from "../Executor";
import { ProjectSettingsProvider } from "../Services/ProjectSettingsProvider";
import { TerminalShell } from "../TerminalShell";
import { LSPClientContext } from "../LSP/lspExtension";
import { CustomError } from "../utils";
import { ProjectEnv } from "../env";
import { BundlePath } from "./BundlePath";
import { LogChannelInterface } from "../Logs/LogChannel";
import { ChildProcess } from "child_process";
import { ProjectManagerInterface } from "../ProjectManager/ProjectManager";

export const UserTerminatedError = new CustomError("User Terminated");
export const UserTerminalCloseError = new CustomError("User Closed Terminal");

interface CommandOptions {
    scriptOrCommand: ShellCommand | ShellFileScript;
    cwd?: string;
    args?: string[];
    env?: { [name: string]: string };
    mode?: ExecutorMode;
    pipeToDebugConsole?: boolean;
    pipeToParseBuildErrors?: boolean;
    pipe?: CommandOptions;
}

export class CommandContext {
    /// project environment
    readonly projectEnv: ProjectEnv;
    /// Xcode project settings provider
    private _projectSettingsProvider: ProjectSettingsProvider;
    get projectSettingsProvider(): ProjectSettingsProvider {
        return this._projectSettingsProvider;
    }

    private _projectManager: ProjectManagerInterface;
    get projectManager(): ProjectManagerInterface {
        return this._projectManager;
    }

    readonly bundle: BundlePath;

    /// debug logs emitter
    private _debugConsoleEmitter = new vscode.EventEmitter<string>();
    get debugConsoleEvent(): vscode.Event<string> {
        return this._debugConsoleEmitter.event;
    }

    /// build logs emitter
    private _buildEmitter = new vscode.EventEmitter<string>();
    get buildEvent(): vscode.Event<string> {
        return this._buildEmitter.event;
    }

    readonly lspClient: LSPClientContext;
    readonly log: LogChannelInterface;

    private _terminal?: TerminalShell;
    public get terminal(): TerminalShell | undefined {
        return this._terminal;
    }

    public setTerminal(terminal: TerminalShell) {
        this._terminal = terminal;
    }

    private _cancellationTokenSource: vscode.CancellationTokenSource;
    public get cancellationToken(): vscode.CancellationToken {
        return this._cancellationTokenSource.token;
    }

    constructor(
        cancellationToken: vscode.CancellationTokenSource,
        terminal: TerminalShell | undefined,
        lspClient: LSPClientContext,
        projectManager: ProjectManagerInterface,
        bundle: BundlePath,
        log: LogChannelInterface
    ) {
        this.bundle = bundle;
        this._cancellationTokenSource = cancellationToken;
        this._projectSettingsProvider = new ProjectSettingsProvider(this);
        this.projectEnv = new ProjectEnv(this._projectSettingsProvider);
        this._projectSettingsProvider.projectEnv = new WeakRef(this.projectEnv);
        this._projectManager = projectManager;
        this._terminal = terminal;
        this.lspClient = lspClient;
        this.log = log;
    }

    private convertToExeParams(shell: CommandOptions, attachTerminal: boolean) {
        const shellExe = shell as ShellExec;
        shellExe.cancellationToken = this._cancellationTokenSource.token;
        const stdoutCallback =
            shell.pipeToDebugConsole === true || shell.pipeToParseBuildErrors === true
                ? (out: string) => {
                      if (shell.pipeToDebugConsole === true) {
                          this._debugConsoleEmitter.fire(out);
                      }
                      if (shell.pipeToParseBuildErrors === true) {
                          this._buildEmitter.fire(out);
                      }
                  }
                : undefined;
        shellExe.stdoutCallback = stdoutCallback;
        if (attachTerminal) {
            shellExe.terminal = this.terminal;
        }

        if (shell.pipe) {
            shellExe.pipe = this.convertToExeParams(shell.pipe, attachTerminal);
        }
        return shell;
    }

    public async execShellWithOptions(shell: CommandOptions): Promise<ShellResult> {
        const shellExe = this.convertToExeParams(shell, true);
        return await new Executor().execShell(shellExe);
    }

    public execShellWithOptionsAndProc(shell: CommandOptions): {
        proc: ChildProcess;
        result: Promise<ShellResult>;
    } {
        const shellExe = this.convertToExeParams(shell, true);
        return new Executor().execShellAndProc(shellExe);
    }

    public async execShell(
        terminalName: string,
        scriptOrCommand: ShellCommand | ShellFileScript,
        args: string[] = [],
        mode: ExecutorMode = ExecutorMode.verbose
    ): Promise<ShellResult> {
        return await new Executor().execShell({
            cancellationToken: this._cancellationTokenSource.token,
            scriptOrCommand: scriptOrCommand,
            args: args,
            mode: mode,
            terminal: this._terminal,
        });
    }

    public async execShellParallel(shell: CommandOptions): Promise<ShellResult> {
        const shellExe = this.convertToExeParams(shell, false);
        return new Executor().execShell(shellExe);
    }

    public waitToCancel() {
        const disLocalCancel: vscode.Disposable[] = [];
        const finishToken = new vscode.EventEmitter<void>();
        const rejectToken = new vscode.EventEmitter<unknown>();
        return {
            wait: new Promise<void>((resolve, reject) => {
                if (this.cancellationToken.isCancellationRequested) {
                    resolve();
                    return;
                }
                disLocalCancel.push(
                    this.cancellationToken.onCancellationRequested(() => {
                        disLocalCancel.forEach(e => e.dispose());
                        reject(UserTerminatedError);
                    })
                );
                disLocalCancel.push(
                    finishToken.event(() => {
                        disLocalCancel.forEach(e => e.dispose());
                        resolve();
                    })
                );
                disLocalCancel.push(
                    rejectToken.event(error => {
                        disLocalCancel.forEach(e => e.dispose());
                        reject(error);
                    })
                );
            }),
            token: finishToken,
            rejectToken: rejectToken,
        };
    }

    public cancel() {
        this._cancellationTokenSource.cancel();
    }
}
