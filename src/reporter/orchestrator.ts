import { compareRequests } from "../comparator/diff.js";
import { SchemaValueGenerator, SeededPRNG } from "../generator/index.js";
import type { IRDocument, IROperation, IRValueRecord } from "../ir/index.js";
import { normalizeRequest } from "../normalization/normalizer.js";
import type { SDKRunner } from "../runners/types.js";
import { shrinkCounterexample } from "../shrinker/engine.js";
import type { ParityReport, ParityReportItem } from "./terminal.js";
import { startCaptureServer } from "../capture/server.js";
import { irRecordToJs } from "../runners/translator.js";

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
  const prng = new SeededPRNG(seed);
  const generator = new SchemaValueGenerator(prng);
  const captureServer = await startCaptureServer();
  const results: ParityReportItem[] = [];

  try {
    for (const operation of doc.operations) {
      const opStartTime = Date.now();

      // Build composite input schema for the operation (path, query, header, body)
      const input = generateOperationInput(operation, generator);

      // Execute on all runners and capture requests
      const testPredicate = async (candidateInput: IRValueRecord) => {
        const sdkNormalizedRequests: Record<string, ReturnType<typeof normalizeRequest>> = {};

        for (const runner of runners) {
          captureServer.clear();
          await runner.execute(operation, candidateInput, captureServer.url);
          const reqs = captureServer.getRequests();
          if (reqs.length > 0) {
            sdkNormalizedRequests[runner.language] = normalizeRequest(reqs[0]);
          }
        }

        return compareRequests(sdkNormalizedRequests);
      };

      const comparison = await testPredicate(input);

      if (!comparison.hasDivergence) {
        results.push({
          operationId: operation.id,
          hasDivergence: false,
          diffs: [],
          durationMs: Date.now() - opStartTime,
        });
      } else {
        let minimizedReproducer: Record<string, unknown> | undefined;
        let shrinkingSteps = 0;

        if (options.shrinkOnFailure !== false) {
          const shrinkRes = await shrinkCounterexample(operation, input, testPredicate);
          minimizedReproducer = irRecordToJs(shrinkRes.minimizedInput);
          shrinkingSteps = shrinkRes.steps;
        } else {
          minimizedReproducer = irRecordToJs(input);
        }

        results.push({
          operationId: operation.id,
          hasDivergence: true,
          diffs: comparison.diffs,
          minimizedReproducer,
          shrinkingSteps,
          durationMs: Date.now() - opStartTime,
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

function generateOperationInput(
  operation: IROperation,
  generator: SchemaValueGenerator
): IRValueRecord {
  const inputs: IRValueRecord = {};

  // Parameters (path, query, headers)
  for (const param of operation.parameters) {
    inputs[param.name] = generator.generate(param.schema);
  }

  // Body
  if (operation.requestBody) {
    const jsonMediaType = operation.requestBody.content["application/json"];
    if (jsonMediaType) {
      inputs.body = generator.generate(jsonMediaType.schema);
    }
  }

  return inputs;
}
