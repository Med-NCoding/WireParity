import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  hashSeed,
  buildFastCheckParameters,
  runPropertyWithReplay,
  replayCounterexample,
  encodeReplayToken,
  decodeReplayToken,
} from "../src/generator/seed.js";

describe("Fast-Check Seed & Replay Infrastructure (Step 6.1)", () => {
  describe("hashSeed", () => {
    it("deterministically produces identical 32-bit integer seeds for the same string", () => {
      const seed1 = hashSeed("wireparity-test-seed");
      const seed2 = hashSeed("wireparity-test-seed");
      expect(seed1).toBe(seed2);
      expect(typeof seed1).toBe("number");
      expect(Number.isInteger(seed1)).toBe(true);
    });

    it("produces distinct seeds for different strings", () => {
      const seedA = hashSeed("seed-alpha");
      const seedB = hashSeed("seed-beta");
      expect(seedA).not.toBe(seedB);
    });

    it("handles numeric seeds directly", () => {
      expect(hashSeed(42)).toBe(42);
      expect(hashSeed(-100)).toBe(-100);
      expect(hashSeed(0)).toBe(1); // 0 coerced to fallback 1
    });
  });

  describe("buildFastCheckParameters", () => {
    it("maps ReplayRunnerOptions to fast-check Parameters object", () => {
      const params = buildFastCheckParameters({
        seed: "my-seed",
        numRuns: 50,
        path: "0:1:0",
        timeout: 5000,
        endOnFailure: true,
      });

      expect(params.seed).toBe(hashSeed("my-seed"));
      expect(params.numRuns).toBe(50);
      expect(params.path).toBe("0:1:0");
      expect(params.timeout).toBe(5000);
      expect(params.endOnFailure).toBe(true);
    });
  });

  describe("runPropertyWithReplay & replayCounterexample", () => {
    it("reports success for properties that pass all runs", async () => {
      const prop = fc.property(fc.integer({ min: 1, max: 100 }), (n) => n > 0);
      const result = await runPropertyWithReplay(prop, {
        seed: "always-positive",
        numRuns: 50,
      });

      expect(result.success).toBe(true);
      expect(result.numRuns).toBe(50);
      expect(result.seed).toBe(hashSeed("always-positive"));
      expect(result.counterexample).toBeUndefined();
      expect(result.path).toBeUndefined();
    });

    it("captures failure, seed, counterexample, and replay path on property violation", async () => {
      // Property: all integers are less than 50 (fails for >= 50)
      const prop = fc.property(fc.integer({ min: 0, max: 100 }), (n) => n < 50);
      const result = await runPropertyWithReplay(prop, {
        seed: 99999,
        numRuns: 100,
      });

      expect(result.success).toBe(false);
      expect(result.seed).toBe(99999);
      expect(result.path).toBeDefined();
      expect(typeof result.path).toBe("string");
      expect(result.counterexample).toBeDefined();
      // Counterexample is array of arguments passed to property [n]
      expect(result.counterexample).toEqual([50]); // Minimal failing integer
      expect(result.numShrinks).toBeGreaterThan(0);
    });

    it("guarantees 100% exact single-shot reproduction via replayCounterexample", async () => {
      // Property fails when string contains 'X'
      const prop = fc.property(
        fc.string({ minLength: 1, maxLength: 10 }),
        (s) => !s.includes("X")
      );

      const initialRun = await runPropertyWithReplay(prop, {
        seed: "reproduce-test-seed",
        numRuns: 100,
      });

      expect(initialRun.success).toBe(false);
      expect(initialRun.path).toBeDefined();
      expect(initialRun.counterexample).toBeDefined();

      // Replay using the exact seed and path
      const replayRun = await replayCounterexample(prop, {
        seed: initialRun.seed,
        path: initialRun.path,
      });

      expect(replayRun.success).toBe(false);
      expect(replayRun.seed).toBe(initialRun.seed);
      expect(replayRun.counterexample).toEqual(initialRun.counterexample);
      expect(replayRun.path).toBe(initialRun.path);
      expect(replayRun.numRuns).toBe(1);
      expect(replayRun.numShrinks).toBe(0); // Exact single-shot reproduction
    });

    it("supports asynchronous properties (fc.asyncProperty)", async () => {
      const asyncProp = fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        async (n) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return n > 0;
        }
      );

      const result = await runPropertyWithReplay(asyncProp, {
        seed: "async-seed",
        numRuns: 10,
      });

      expect(result.success).toBe(true);
      expect(result.numRuns).toBe(10);
    });
  });

  describe("Token Encoding & Decoding", () => {
    it("encodes and decodes replay descriptor with path", () => {
      const descriptor = { seed: 12345, path: "0:1:2:0" };
      const token = encodeReplayToken(descriptor);
      expect(token).toBe("12345:0:1:2:0");

      const decoded = decodeReplayToken(token);
      expect(decoded).toEqual(descriptor);
    });

    it("encodes and decodes replay descriptor without path", () => {
      const descriptor = { seed: 54321 };
      const token = encodeReplayToken(descriptor);
      expect(token).toBe("54321");

      const decoded = decodeReplayToken(token);
      expect(decoded).toEqual({ seed: 54321, path: undefined });
    });
  });
});
