import { compareRequests } from "../comparator/diff.js";
import type { IRDocument } from "../ir/index.js";
import type { OperationInputs } from "../ir/inputs.js";
import { normalizeContractRequest } from "../normalization/normalizer.js";
import type { NormalizedRequest } from "../normalization/types.js";
import type { SDKRunner } from "../runners/types.js";
import { runOperationParityTest, operationInputsToRecord } from "../shrinker/fast_check_shrink.js";
import type { ParityReport, ParityReportItem } from "./terminal.js";
import { startCaptureServer } from "../capture/server.js";



export interface SuiteRunnerOptions {
  seed?: string | number;
  iterationsPerOperation?: number;
  shrinkOnFailure?: boolean;
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

  try {
    for (const operation of doc.operations) {
      const testPredicate = async (candidateInput: OperationInputs) => {
        const sdkNormalizedRequests: Record<string, NormalizedRequest> = {};

        for (const runner of runners) {
          captureServer.clear();
          await runner.execute(operation, candidateInput, captureServer.url);
          const reqs = captureServer.getRequests();
          if (reqs.length > 0) {
            sdkNormalizedRequests[runner.language] = normalizeContractRequest(reqs[0]!, operation);
          }
        }


        return compareRequests(sdkNormalizedRequests);
      };


      const iterations = options.iterationsPerOperation ?? 5;
      const testResult = await runOperationParityTest(operation, testPredicate, {
        seed,
        numRuns: iterations,
        endOnFailure: true,
      });

      if (!testResult.hasDivergence) {
        results.push({
          operationId: operation.id,
          hasDivergence: false,
          diffs: [],
          seed: testResult.seed,
          durationMs: testResult.durationMs,
        });
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
      }
    }
  } finally {
    await captureServer.close();
  }

  const passedOperations = results.filter((r) => !r.hasDivergence).length;
  const divergentOperations = results.length - passedOperations;

  return {
    title: doc.title,
    seed,
    totalOperations: results.length,
    passedOperations,
    divergentOperations,
    results,
  };
}

