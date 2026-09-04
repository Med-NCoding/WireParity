import { compareRequests } from "../comparator/diff.js";
import type { IRDocument } from "../ir/index.js";
import type { OperationInputs } from "../ir/inputs.js";
import { normalizeContractRequest } from "../normalization/normalizer.js";
import type { NormalizedRequest } from "../normalization/types.js";
import type { SDKRunner } from "../runners/types.js";
import { runOperationParityTest, operationInputsToRecord } from "../shrinker/fast_check_shrink.js";
import { decodeReplayToken } from "../generator/seed.js";
import type { ParityReport, ParityReportItem } from "./terminal.js";
import { startCaptureServer } from "../capture/server.js";





export interface SuiteRunnerOptions {
  seed?: string | number;
  replayPath?: string;
  replayToken?: string;
  iterationsPerOperation?: number;
  shrinkOnFailure?: boolean;
  bail?: boolean;
  operations?: string[];
}

/**
 * Orchestrates a complete differential testing run across multiple SDK runners for an OpenAPI IR Document.
 */
export async function runParitySuite(
  doc: IRDocument,
  runners: SDKRunner[],
  options: SuiteRunnerOptions = {}
): Promise<ParityReport> {
  const seed = options.seed ?? "wireparity-seed";
  const captureServer = await startCaptureServer();
  const results: ParityReportItem[] = [];

  const targetOperations =
    options.operations && options.operations.length > 0
      ? doc.operations.filter((op) => options.operations!.includes(op.id))
      : doc.operations;

  try {
    for (const operation of targetOperations) {
      let operationExecutionError: string | undefined;

      const testPredicate = async (candidateInput: OperationInputs) => {
        const sdkNormalizedRequests: Record<string, NormalizedRequest> = {};

        for (let i = 0; i < runners.length; i++) {
          const runner = runners[i]!;
          const runnerKey = runners.filter((r) => r.language === runner.language).length > 1
            ? `${runner.language}_${i + 1}`
            : runner.language;

          captureServer.clear();
          let runnerResult;
          try {
            runnerResult = await runner.execute(operation, candidateInput, captureServer.url);
          } catch (err: unknown) {
            const errorMsg = `Runner '${runnerKey}' threw an error: ${err instanceof Error ? err.message : String(err)}`;
            operationExecutionError = errorMsg;
            return {
              hasDivergence: false,
              executionError: errorMsg,
              diffs: [],
              sdkRequests: sdkNormalizedRequests,
            };
          }

          if (!runnerResult.success) {
            const errorMsg = runnerResult.error
              ? `Runner '${runnerKey}' failed: ${runnerResult.error}`
              : `Runner '${runnerKey}' returned success: false`;
            operationExecutionError = errorMsg;
            return {
              hasDivergence: false,
              executionError: errorMsg,
              diffs: [],
              sdkRequests: sdkNormalizedRequests,
            };
          }

          const reqs = captureServer.getRequests();
          if (reqs.length === 0) {
            const errorMsg = `Runner '${runnerKey}' produced no captured HTTP request for operation '${operation.id}'`;
            operationExecutionError = errorMsg;
            return {
              hasDivergence: false,
              executionError: errorMsg,
              diffs: [],
              sdkRequests: sdkNormalizedRequests,
            };
          }

          sdkNormalizedRequests[runnerKey] = normalizeContractRequest(reqs[0]!, operation);
        }

        if (Object.keys(sdkNormalizedRequests).length < runners.length) {
          const errorMsg = `Fewer runners emitted requests than expected for operation '${operation.id}': received ${Object.keys(sdkNormalizedRequests).length} of ${runners.length}`;
          operationExecutionError = errorMsg;
          return {
            hasDivergence: false,
            executionError: errorMsg,
            diffs: [],
            sdkRequests: sdkNormalizedRequests,
          };
        }

        return compareRequests(sdkNormalizedRequests);
      };

      let replaySeed = seed;
      let replayPath = options.replayPath;
      if (options.replayToken) {
        const decoded = decodeReplayToken(options.replayToken);
        replaySeed = decoded.seed;
        replayPath = decoded.path;
      }

      const iterations = options.iterationsPerOperation ?? 5;
      const testResult = await runOperationParityTest(operation, testPredicate, {
        seed: replaySeed,
        path: replayPath,
        numRuns: iterations,
        endOnFailure: true,
      });

      const execError = operationExecutionError ?? testResult.executionError;

      if (!testResult.hasDivergence && !execError) {
        results.push({
          operationId: operation.id,
          hasDivergence: false,
          diffs: [],
          seed: testResult.seed,
          durationMs: testResult.durationMs,
        });
      } else if (execError) {
        results.push({
          operationId: operation.id,
          hasDivergence: false,
          executionError: execError,
          diffs: [],
          durationMs: testResult.durationMs,
        });

        if (options.bail) {
          break;
        }
      } else {
        results.push({
          operationId: operation.id,
          hasDivergence: true,
          diffs: testResult.diffs,
          minimizedReproducer: testResult.minimizedReproducer,
          shrinkingSteps: testResult.numShrinks,
          seed: testResult.seed,
          path: testResult.path,
          replayToken: testResult.replayToken,
          durationMs: testResult.durationMs,
        });

        if (options.bail) {
          break;
        }
      }
    }
  } finally {
    await captureServer.close();
  }

  const passedOperations = results.filter((r) => !r.hasDivergence && !r.executionError).length;
  const executionErrorOperations = results.filter((r) => !!r.executionError).length;
  const divergentOperations = results.filter((r) => r.hasDivergence && !r.executionError).length;

  return {
    title: doc.title,
    seed,
    totalOperations: results.length,
    passedOperations,
    divergentOperations,
    executionErrorOperations,
    results,
  };
}

