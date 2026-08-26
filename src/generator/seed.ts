/**
 * WireParity - Fast-Check Seed & Replay Infrastructure (Step 6.1)
 *
 * Provides deterministic seed hashing, fast-check test runner configuration,
 * and 100% reproducible counterexample replay via fast-check seed + path tokens.
 */

import * as fc from "fast-check";

/**
 * Replay descriptor storing the exact seed and counterexample path
 * required to reproduce a failure in a single shot.
 */
export interface ReplayDescriptor {
  /** Numeric seed (32-bit integer) used for PRNG initialization */
  seed: number;
  /** Counterexample path string from fast-check (e.g. "0:1:0:0:...") */
  path?: string;
}

/**
 * Configuration options for fast-check test runs.
 */
export interface ReplayRunnerOptions {
  /** User-provided seed string or number */
  seed?: string | number;
  /** Fast-check replay counterexample path */
  path?: string;
  /** Number of test runs to execute (default: 100) */
  numRuns?: number;
  /** Maximum number of skips allowed per run */
  maxSkipsPerRun?: number;
  /** Timeout per run in milliseconds */
  timeout?: number;
  /** Whether to stop immediately on first failure (default: true) */
  endOnFailure?: boolean;
}

/**
 * Structured outcome of running a property test with seed/replay metadata.
 */
export interface ReplayResult<T = unknown> {
  /** Whether all property test iterations passed without error */
  success: boolean;
  /** The 32-bit numeric seed used for the test run */
  seed: number;
  /** The replay path if a failure occurred */
  path?: string;
  /** Number of runs executed before passing or failing */
  numRuns: number;
  /** Number of shrink steps applied to reach the minimal counterexample */
  numShrinks: number;
  /** The minimal counterexample argument(s) if the test failed */
  counterexample?: T;
  /** Error message or description if the test failed */
  error?: string;
}

/**
 * Deterministically hashes a string or number into a valid 32-bit signed integer
 * suitable for use as a fast-check PRNG seed.
 *
 * Uses the Mulberry32 hash algorithm for uniform bit dispersion.
 */
export function hashSeed(seed: string | number): number {
  if (typeof seed === "number") {
    // Coerce to 32-bit signed integer
    return (seed | 0) || 1;
  }

  let hash = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return (hash | 0) || 1;
}

/**
 * Converts ReplayRunnerOptions into fast-check Parameters object.
 */
export function buildFastCheckParameters(
  options: ReplayRunnerOptions = {}
): fc.Parameters<unknown> {
  const seed = options.seed !== undefined ? hashSeed(options.seed) : hashSeed(Date.now());
  const params: fc.Parameters<unknown> = {
    seed,
    numRuns: options.numRuns ?? 100,
  };

  if (options.endOnFailure !== undefined) {
    params.endOnFailure = options.endOnFailure;
  }

  if (options.path) {
    params.path = options.path;
  }

  if (options.maxSkipsPerRun !== undefined) {
    params.maxSkipsPerRun = options.maxSkipsPerRun;
  }

  if (options.timeout !== undefined) {
    params.timeout = options.timeout;
  }

  return params;
}

/**
 * Runs a synchronous or asynchronous fast-check property with deterministic seed
 * and replay path tracking.
 *
 * @param property - A fast-check property or asyncProperty.
 * @param options  - Test execution options (seed, path, numRuns, etc.).
 * @returns        ReplayResult with full reproduction details.
 */
export async function runPropertyWithReplay<T>(
  property: fc.IRawProperty<T, boolean>,
  options: ReplayRunnerOptions = {}
): Promise<ReplayResult<T>> {
  const params = buildFastCheckParameters(options);
  const out = await fc.check(property, params);

  if (!out.failed) {
    return {
      success: true,
      seed: out.seed,
      numRuns: out.numRuns,
      numShrinks: out.numShrinks,
    };
  }

  const failOut = out as {
    error?: string;
    counterexample?: unknown;
    counterexamplePath?: string;
  };

  return {
    success: false,
    seed: out.seed,
    path: failOut.counterexamplePath ?? undefined,
    numRuns: out.numRuns,
    numShrinks: out.numShrinks,
    counterexample: failOut.counterexample !== undefined && failOut.counterexample !== null ? (failOut.counterexample as T) : undefined,
    error: failOut.error ?? undefined,
  };
}

/**
 * Replays a specific counterexample using a previously captured ReplayDescriptor.
 * Guaranteed to reproduce the exact counterexample in 1 run.
 *
 * @param property - The same fast-check property that failed previously.
 * @param replay   - ReplayDescriptor containing seed and path.
 * @returns        ReplayResult capturing the replayed failure.
 */
export async function replayCounterexample<T>(
  property: fc.IRawProperty<T, boolean>,
  replay: ReplayDescriptor
): Promise<ReplayResult<T>> {
  return runPropertyWithReplay(property, {
    seed: replay.seed,
    path: replay.path,
    numRuns: 1,
  });
}

/**
 * Encodes a ReplayDescriptor into a compact string representation (e.g. "12345:0:1:0").
 */
export function encodeReplayToken(replay: ReplayDescriptor): string {
  if (replay.path) {
    return `${replay.seed}:${replay.path}`;
  }
  return `${replay.seed}`;
}

/**
 * Decodes a ReplayDescriptor from a string token.
 */
export function decodeReplayToken(token: string): ReplayDescriptor {
  const colonIdx = token.indexOf(":");
  if (colonIdx === -1) {
    return { seed: parseInt(token, 10) || 1 };
  }
  const seed = parseInt(token.slice(0, colonIdx), 10) || 1;
  const path = token.slice(colonIdx + 1);
  return { seed, path: path || undefined };
}
