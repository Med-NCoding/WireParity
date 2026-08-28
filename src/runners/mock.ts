import type { IROperation, IRValueRecord } from "../ir/index.js";
import { isOperationInputs, type OperationInputs } from "../ir/inputs.js";
import { irRecordToJs, irValueToJs } from "./translator.js";
import type { RunnerResult, SDKRunner } from "./types.js";

export type MockSdkInvocationHandler = (
  operation: IROperation,
  jsInputs: Record<string, unknown>,
  targetUrl: string
) => Promise<void>;

/**
 * Mock / In-Process SDK Runner for fast unit testing and deterministic simulation
 * of TypeScript SDK behaviors.
 */
export class MockSDKRunner implements SDKRunner {
  constructor(
    public readonly language: "typescript" | "python" | "go" | "mock",
    private readonly handler: MockSdkInvocationHandler
  ) {}

  async execute(
    operation: IROperation,
    input: IRValueRecord | OperationInputs,
    targetUrl: string
  ): Promise<RunnerResult> {
    const startTime = Date.now();
    try {
      let jsInputs: Record<string, unknown>;
      if (isOperationInputs(input)) {
        jsInputs = {
          ...irRecordToJs(input.pathParams),
          ...irRecordToJs(input.queryParams),
          ...irRecordToJs(input.headerParams),
          body: input.body ? irValueToJs(input.body) : undefined,
        };
      } else {
        jsInputs = irRecordToJs(input);
      }
      await this.handler(operation, jsInputs, targetUrl);
      return {
        success: true,
        language: this.language,
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {

      return {
        success: false,
        language: this.language,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
