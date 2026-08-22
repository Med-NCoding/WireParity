import type { ComparisonResult } from "../comparator/types.js";
import type { IROperation, IRValue, IRValueRecord } from "../ir/index.js";
import { shrinkValue } from "./strategies.js";

export type TestPredicate = (input: IRValueRecord) => Promise<ComparisonResult>;

export interface ShrinkResult {
  minimizedInput: IRValueRecord;
  steps: number;
  lastComparison: ComparisonResult;
}

/**
 * Delta-debugging shrinker that iteratively reduces failing inputs
 * while ensuring the divergence persists.
 */
export async function shrinkCounterexample(
  _operation: IROperation,
  initialInput: IRValueRecord,
  predicate: TestPredicate,
  maxSteps = 50
): Promise<ShrinkResult> {
  let currentInput = initialInput;
  let lastComparison = await predicate(currentInput);

  if (!lastComparison.hasDivergence) {
    return {
      minimizedInput: initialInput,
      steps: 0,
      lastComparison,
    };
  }

  const targetCategory = lastComparison.diffs[0]?.category;
  let steps = 0;

  let madeProgress = true;
  while (madeProgress && steps < maxSteps) {
    madeProgress = false;
    const candidateInputs = generateRecordShrinkCandidates(currentInput);

    for (const candidate of candidateInputs) {
      steps += 1;
      const comp = await predicate(candidate);
      // Check if divergence still occurs and matches the target category
      if (comp.hasDivergence && comp.diffs[0]?.category === targetCategory) {
        currentInput = candidate;
        lastComparison = comp;
        madeProgress = true;
        break; // take the first successful shrink and continue loop
      }
      if (steps >= maxSteps) break;
    }
  }

  return {
    minimizedInput: currentInput,
    steps,
    lastComparison,
  };
}

function generateRecordShrinkCandidates(record: IRValueRecord): IRValueRecord[] {
  const candidates: IRValueRecord[] = [];
  const keys = Object.keys(record);

  // Try removing top-level keys
  if (keys.length > 1) {
    for (const key of keys) {
      const copy = { ...record };
      delete copy[key];
      candidates.push(copy);
    }
  }

  // Try shrinking each key's value
  for (const key of keys) {
    const valShrinks = shrinkValue(record[key]);
    for (const shrunkVal of valShrinks) {
      candidates.push({
        ...record,
        [key]: shrunkVal,
      });
    }
  }

  return candidates;
}
