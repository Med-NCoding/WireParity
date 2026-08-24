import { spawn } from "node:child_process";
import type { OperationInputs } from "../ir/inputs.js";
import type { IROperation, IRValueRecord } from "../ir/index.js";
import { irRecordToJs } from "./translator.js";
import {
  decodeIPCResponse,
  encodeIPCRequest,
  type IPCRequest,
  type IPCResponse,
  type RunnerResult,
  type SDKLanguage,
  type SDKRunner,
} from "./types.js";

export interface SubprocessRunnerOptions {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

/**
 * Invokes a subprocess runner using the canonical JSON-lines IPC protocol.
 *
 * Protocol (Step 3.1):
 *   stdin  ← one JSON line: IPCRequest { operationId, inputs: OperationInputs, targetUrl }
 *   stdout → one JSON line: IPCResponse { success, capturedRequest?, error?, stderr? }
 *
 * The subprocess must write exactly one JSON line to stdout and then exit.
 * Any content on stderr is captured and surfaced in the RunnerResult.
 * A configurable timeout (default 15 s) kills the process and returns a
 * failure result if the subprocess does not exit in time.
 */
export class SubprocessSDKRunner implements SDKRunner {
  constructor(
    public readonly language: SDKLanguage,
    private readonly options: SubprocessRunnerOptions
  ) {}

  async execute(
    operation: IROperation,
    input: IRValueRecord,
    targetUrl: string
  ): Promise<RunnerResult> {
    // Build typed OperationInputs from flat IRValueRecord
    const operationInputs: OperationInputs = {
      pathParams: {},
      queryParams: {},
      headerParams: {},
      body: input["body"],
    };

    const ipcRequest: IPCRequest = {
      operationId: operation.id,
      inputs: operationInputs,
      targetUrl,
    };

    return this._sendRequest(ipcRequest);
  }

  /**
   * Sends a pre-built IPCRequest to the subprocess and awaits its IPCResponse.
   * Exposed for direct use in IPC protocol tests.
   */
  async sendRequest(req: IPCRequest): Promise<RunnerResult & { ipcResponse?: IPCResponse }> {
    return this._sendRequest(req);
  }

  private _sendRequest(
    req: IPCRequest
  ): Promise<RunnerResult & { ipcResponse?: IPCResponse }> {
    const startTime = Date.now();
    const timeoutMs = this.options.timeoutMs ?? 15000;

    return new Promise((resolve) => {
      let settled = false;

      const child = spawn(this.options.command, this.options.args ?? [], {
        cwd: this.options.cwd,
        env: { ...process.env, ...this.options.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdoutBuf = "";
      let stderrBuf = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString("utf-8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString("utf-8");
      });

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill("SIGKILL");
          resolve({
            success: false,
            language: this.language,
            durationMs: Date.now() - startTime,
            error: `Subprocess timed out after ${timeoutMs}ms`,
            rawOutput: stderrBuf,
          });
        }
      }, timeoutMs);

      child.on("close", (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        const durationMs = Date.now() - startTime;

        // Parse the first non-empty JSON line from stdout as IPCResponse
        const firstLine = stdoutBuf.split("\n").find((l) => l.trim().length > 0) ?? "";

        if (code !== 0 && firstLine.length === 0) {
          resolve({
            success: false,
            language: this.language,
            durationMs,
            error: stderrBuf.trim() || `Subprocess exited with code ${code}`,
            rawOutput: stdoutBuf,
          });
          return;
        }

        let ipcResponse: IPCResponse;
        try {
          ipcResponse = decodeIPCResponse(firstLine);
        } catch (parseErr) {
          resolve({
            success: false,
            language: this.language,
            durationMs,
            error: parseErr instanceof Error ? parseErr.message : String(parseErr),
            rawOutput: stdoutBuf,
          });
          return;
        }

        resolve({
          success: ipcResponse.success,
          language: this.language,
          durationMs,
          error: ipcResponse.error ?? (ipcResponse.success ? undefined : `Subprocess exited with code ${code}`),
          rawOutput: stdoutBuf,
          ipcResponse,
        });
      });

      child.on("error", (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          success: false,
          language: this.language,
          durationMs: Date.now() - startTime,
          error: err.message,
        });
      });

      // Write the IPC request as one JSON line to stdin
      try {
        child.stdin.write(encodeIPCRequest(req) + "\n");
        child.stdin.end();
      } catch (err: unknown) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({
            success: false,
            language: this.language,
            durationMs: Date.now() - startTime,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });
  }
}
