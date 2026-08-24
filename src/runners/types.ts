import type { IROperation, IRValueRecord } from "../ir/index.js";
import type { OperationInputs } from "../ir/inputs.js";

export type SDKLanguage = "typescript" | "python" | "go" | "mock";

export interface RunnerInvocation {
  operationId: string;
  parameters: Record<string, unknown>; // language serialized values
  targetUrl: string;
  authHeader?: string;
}

export interface RunnerResult {
  success: boolean;
  language: SDKLanguage;
  durationMs: number;
  error?: string;
  rawOutput?: string;
}

export interface SDKRunner {
  language: SDKLanguage;
  execute(
    operation: IROperation,
    input: IRValueRecord,
    targetUrl: string
  ): Promise<RunnerResult>;
}

// ---------------------------------------------------------------------------
// JSON-lines IPC Protocol (Step 3.1)
// ---------------------------------------------------------------------------

/**
 * Request message sent to a subprocess runner over stdin (one JSON line).
 * The subprocess reads exactly one line, executes the SDK call, and writes
 * one IPCResponse line to stdout before exiting.
 */
export interface IPCRequest {
  operationId: string;
  inputs: OperationInputs;
  targetUrl: string;
}

/**
 * Response message written by a subprocess runner to stdout (one JSON line).
 * `capturedRequest` holds the raw HTTP details observed on the wire so the
 * orchestrator can normalise and diff them across languages.
 */
export interface IPCResponse {
  success: boolean;
  capturedRequest?: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  error?: string;
  stderr?: string;
}

/**
 * Serialises an IPCRequest to a single JSON line (no trailing newline).
 */
export function encodeIPCRequest(req: IPCRequest): string {
  return JSON.stringify(req);
}

/**
 * Parses a single JSON line from a subprocess stdout into an IPCResponse.
 * Throws if the line is not valid JSON or does not contain `success`.
 */
export function decodeIPCResponse(line: string): IPCResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.trim());
  } catch {
    throw new Error(`IPCResponse parse error: invalid JSON: ${JSON.stringify(line)}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("success" in parsed) ||
    typeof (parsed as Record<string, unknown>).success !== "boolean"
  ) {
    throw new Error(`IPCResponse parse error: missing or non-boolean 'success' field`);
  }
  return parsed as IPCResponse;
}
