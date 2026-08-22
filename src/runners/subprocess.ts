import { spawn } from "node:child_process";
import type { IROperation, IRValueRecord } from "../ir/index.js";
import { irRecordToJs } from "./translator.js";
import type { RunnerResult, SDKLanguage, SDKRunner } from "./types.js";

export interface SubprocessRunnerOptions {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

/**
 * Subprocess SDK Runner executing external TypeScript (node), Python (python3), or Go binaries.
 * Sends JSON IPC payload over stdin and awaits exit / completion.
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
    const startTime = Date.now();
    const timeoutMs = this.options.timeoutMs ?? 15000;

    const payload = {
      operationId: operation.id,
      method: operation.method,
      path: operation.path,
      targetUrl,
      inputs: irRecordToJs(input),
    };

    return new Promise<RunnerResult>((resolve) => {
      let settled = false;
      const child = spawn(this.options.command, this.options.args ?? [], {
        cwd: this.options.cwd,
        env: { ...process.env, ...this.options.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill("SIGKILL");
          resolve({
            success: false,
            language: this.language,
            durationMs: Date.now() - startTime,
            error: `Process timed out after ${timeoutMs}ms`,
            rawOutput: stderr,
          });
        }
      }, timeoutMs);

      child.on("close", (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (code === 0) {
          resolve({
            success: true,
            language: this.language,
            durationMs: Date.now() - startTime,
            rawOutput: stdout,
          });
        } else {
          resolve({
            success: false,
            language: this.language,
            durationMs: Date.now() - startTime,
            error: stderr || `Process exited with code ${code}`,
            rawOutput: stdout,
          });
        }
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

      // Write IPC input
      try {
        child.stdin.write(JSON.stringify(payload) + "\n");
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
