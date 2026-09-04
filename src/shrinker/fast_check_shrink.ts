/**
 * WireParity - Fast-Check Property Test Loop & Replay Path Shrinking (Step 7.4)
 *
 * Implements a property-based differential test loop using fast-check:
 *   - Runs multi-iteration property tests over generated `OperationInputs`
 *   - Automatically shrinks failing input trees to minimal counterexamples
 *   - Captures deterministic seed and replay path tokens for single-shot reproduction
 *   - Validates that the shrunk counterexample preserves the divergence category
 */

import * as fc from "fast-check";
import type { ComparisonResult, SemanticDiff, DivergenceCategory } from "../comparator/types.js";
import {
  buildFastCheckParameters,
  encodeReplayToken,
  decodeReplayToken,
  type ReplayDescriptor,
  type ReplayRunnerOptions,
} from "../generator/seed.js";

import { operationInputsArbitrary } from "../generator/synthesizer.js";
import type { IROperation } from "../ir/operations.js";
import type { OperationInputs } from "../ir/inputs.js";
import type { IRValueRecord } from "../ir/values.js";
import { irRecordToJs, irValueToJs } from "../runners/translator.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ParityTestPredicate = (
  inputs: OperationInputs
) => Promise<ComparisonResult>;

export interface FastCheckParityOptions extends ReplayRunnerOptions {
  /** Optional target category to filter or preserve */
  targetCategory?: DivergenceCategory;
}

export interface FastCheckOperationResult {
  operationId: string;
  hasDivergence: boolean;
  executionError?: string;
  seed: number;
  path?: string;
  replayToken?: string;
  numRuns: number;
  numShrinks: number;
  diffs: SemanticDiff[];
  counterexample?: OperationInputs;
  minimizedReproducer?: Record<string, unknown>;
  preservedCategory?: boolean;
  durationMs: number;
  error?: string;
}

// ─── Translators ──────────────────────────────────────────────────────────────

/**
 * Converts structured OperationInputs to a clean JS dictionary for reporting.
 */
export function operationInputsToJs(inputs: OperationInputs): Record<string, unknown> {
  const res: Record<string, unknown> = {};

  if (inputs.pathParams && Object.keys(inputs.pathParams).length > 0) {
    res.pathParams = irRecordToJs(inputs.pathParams);
  }
  if (inputs.queryParams && Object.keys(inputs.queryParams).length > 0) {
    res.queryParams = irRecordToJs(inputs.queryParams);
  }
  if (inputs.headerParams && Object.keys(inputs.headerParams).length > 0) {
    res.headerParams = irRecordToJs(inputs.headerParams);
  }
  if (inputs.cookieParams && Object.keys(inputs.cookieParams).length > 0) {
    res.cookieParams = irRecordToJs(inputs.cookieParams);
  }
  if (inputs.body !== undefined) {
    res.body = irValueToJs(inputs.body);
  }

  return res;
}

/**
 * Flattens structured OperationInputs into an IRValueRecord for legacy runners.
 */
export function operationInputsToRecord(inputs: OperationInputs): IRValueRecord {
  const record: IRValueRecord = {};

  for (const [k, v] of Object.entries(inputs.pathParams ?? {})) {
    record[k] = v;
  }
  for (const [k, v] of Object.entries(inputs.queryParams ?? {})) {
    record[k] = v;
  }
  for (const [k, v] of Object.entries(inputs.headerParams ?? {})) {
    record[k] = v;
  }
  if (inputs.cookieParams) {
    for (const [k, v] of Object.entries(inputs.cookieParams)) {
      record[k] = v;
    }
  }
  if (inputs.body !== undefined) {
    record.body = inputs.body;
  }

  return record;
}

// ─── Main Property Test Loop ──────────────────────────────────────────────────

/**
 * Executes a fast-check property test loop for an `IROperation` against a differential predicate.
 * When a divergence is found, fast-check automatically shrinks the input tree to its minimal
 * reproducible form while recording the seed and replay path.
 */
export async function runOperationParityTest(
  operation: IROperation,
  predicate: ParityTestPredicate,
  options: FastCheckParityOptions = {}
): Promise<FastCheckOperationResult> {
  const startTime = Date.now();
  const arbitrary = operationInputsArbitrary(operation);

  let initialFailureCategory: DivergenceCategory | undefined;
  let initialFailureDiffs: SemanticDiff[] = [];
  let initialExecutionError: string | undefined;

  const property = fc.asyncProperty(arbitrary, async (inputs) => {
    try {
      const comp = await predicate(inputs);
      if (comp.hasDivergence) {
        if (!initialFailureCategory && comp.diffs.length > 0) {
          initialFailureCategory = comp.diffs[0]?.category;
          initialFailureDiffs = comp.diffs;
        }
        if (!initialExecutionError && comp.executionError) {
          initialExecutionError = comp.executionError;
        }
        // If user specified a target category, only fail if category matches
        if (options.targetCategory && comp.diffs[0]?.category !== options.targetCategory) {
          return true;
        }
        return false; // failure triggers shrinking
      }
      return true;
    } catch (err: unknown) {
      initialExecutionError = err instanceof Error ? err.message : String(err);
      return false;
    }
  });

  const params = buildFastCheckParameters({
    seed: options.seed,
    path: options.path,
    numRuns: options.numRuns ?? 100,
    maxSkipsPerRun: options.maxSkipsPerRun,
    timeout: options.timeout,
    endOnFailure: options.endOnFailure ?? true,
  });

  const out = await fc.check(property, params);
  const durationMs = Date.now() - startTime;

  if (!out.failed) {
    return {
      operationId: operation.id,
      hasDivergence: false,
      seed: out.seed,
      numRuns: out.numRuns,
      numShrinks: 0,
      diffs: [],
      durationMs,
    };
  }

  const failOut = out as {
    error?: string;
    counterexample?: unknown[];
    counterexamplePath?: string;
  };

  const counterexample =
    failOut.counterexample && failOut.counterexample.length > 0
      ? (failOut.counterexample[0] as OperationInputs)
      : undefined;

  let finalDiffs: SemanticDiff[] = initialFailureDiffs;
  let finalExecutionError: string | undefined = initialExecutionError;
  let preservedCategory = true;

  if (counterexample) {
    try {
      // Run predicate one final time on the minimal counterexample to capture exact diffs
      const finalComp = await predicate(counterexample);
      if (finalComp.hasDivergence) {
        finalDiffs = finalComp.diffs;
        if (finalComp.executionError) {
          finalExecutionError = finalComp.executionError;
        }
        if (initialFailureCategory) {
          preservedCategory = finalDiffs.some((d) => d.category === initialFailureCategory);
        }
      }
    } catch (err: unknown) {
      finalExecutionError = err instanceof Error ? err.message : String(err);
    }
  }

  const replayDescriptor: ReplayDescriptor = {
    seed: out.seed,
    path: failOut.counterexamplePath,
  };
  const replayToken = encodeReplayToken(replayDescriptor);

  return {
    operationId: operation.id,
    hasDivergence: true,
    executionError: finalExecutionError,
    seed: out.seed,
    path: failOut.counterexamplePath,
    replayToken,
    numRuns: out.numRuns,
    numShrinks: out.numShrinks,
    diffs: finalDiffs,
    counterexample,
    minimizedReproducer: counterexample ? operationInputsToJs(counterexample) : undefined,
    preservedCategory,
    durationMs,
    error: failOut.error ?? finalExecutionError,
  };
}

/**
 * Replays a failing property test in 1 shot using a captured ReplayDescriptor or replay token string.
 */
export async function replayOperationParityTest(
  operation: IROperation,
  predicate: ParityTestPredicate,
  replay: ReplayDescriptor | string
): Promise<FastCheckOperationResult> {
  const descriptor = typeof replay === "string" ? decodeReplayToken(replay) : replay;
  return runOperationParityTest(operation, predicate, {
    seed: descriptor.seed,
    path: descriptor.path,
    numRuns: 1,
    endOnFailure: true,
  });
}

