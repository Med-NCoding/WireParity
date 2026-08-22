import type { IROperation, IRValueRecord } from "../ir/index.js";

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
