/**
 * WireParity - Step 10.3: Telemetry & Benchmark Metrics Reporter Tests
 */

import { describe, it, expect } from "vitest";
import {
  computeTelemetryMetrics,
  formatTelemetrySummary,
  formatTelemetryJson,
  type TelemetryMetrics,
} from "../src/telemetry/metrics.js";
import type { ParityReport } from "../src/reporter/terminal.js";

describe("Telemetry & Benchmark Metrics Reporter (Step 10.3)", () => {
  const passingReport: ParityReport = {
    title: "GitHub Issues API Spec",
    seed: "benchmark-seed-100",
    totalOperations: 4,
    passedOperations: 4,
    divergentOperations: 0,
    results: [
      { operationId: "getRepo", hasDivergence: false, diffs: [], durationMs: 25 },
      { operationId: "listIssues", hasDivergence: false, diffs: [], durationMs: 40 },
      { operationId: "createIssue", hasDivergence: false, diffs: [], durationMs: 35 },
      { operationId: "updateIssue", hasDivergence: false, diffs: [], durationMs: 20 },
    ],
  };

  const genuineDivergentReport: ParityReport = {
    title: "Production PetStore API",
    seed: "genuine-prod-seed",
    totalOperations: 3,
    passedOperations: 1,
    divergentOperations: 2,
    results: [
      {
        operationId: "getPetById",
        hasDivergence: false,
        diffs: [],
        durationMs: 15,
      },
      {
        operationId: "createPet",
        hasDivergence: true,
        diffs: [
          {
            category: "OPTIONAL_VS_NULL",
            severity: "warning",
            location: "body",
            path: "body.tag",
            message: "Field 'body.tag' omitted in SDK A but null in SDK B",
            expected: undefined,
            actual: null,
            sdkA: "typescript",
            sdkB: "python",
          },
        ],
        minimizedReproducer: { name: "Fido", tag: null },
        shrinkingSteps: 5,
        durationMs: 45,
      },
      {
        operationId: "listPets",
        hasDivergence: true,
        diffs: [
          {
            category: "QUERY_ARRAY_ENCODING",
            severity: "critical",
            location: "query",
            path: "query.status",
            message: "Array encoding mismatch in query param 'status'",
            expected: "available,pending",
            actual: ["available", "pending"],
            sdkA: "typescript",
            sdkB: "python",
          },
        ],
        minimizedReproducer: { queryParams: { status: ["available", "pending"] } },
        shrinkingSteps: 8,
        durationMs: 60,
      },
    ],
  };

  const syntheticBugReport: ParityReport = {
    title: "Synthetic Bug Regression Suite",
    seed: "synthetic-injected-seed",
    totalOperations: 2,
    passedOperations: 1,
    divergentOperations: 1,
    results: [
      {
        operationId: "op1",
        hasDivergence: false,
        diffs: [],
        durationMs: 10,
      },
      {
        operationId: "op2",
        hasDivergence: true,
        diffs: [
          {
            category: "CASE_CONVENTION_LEAK",
            severity: "critical",
            location: "body",
            path: "body.pet_name",
            message: "Case convention leak",
            expected: "petName",
            actual: "pet_name",
            sdkA: "typescript",
            sdkB: "python",
          },
        ],
        minimizedReproducer: { pet_name: "test" },
        shrinkingSteps: 3,
        durationMs: 30,
      },
    ],
  };

  it("calculates telemetry metrics for 100% passing benchmark suite", () => {
    const fixedTime = "2026-08-27T21:00:00.000Z";
    const metrics = computeTelemetryMetrics(passingReport, {
      timestamp: fixedTime,
      iterationsPerOperation: 10,
    });

    expect(metrics.timestamp).toBe(fixedTime);
    expect(metrics.specTitle).toBe("GitHub Issues API Spec");
    expect(metrics.totalOperations).toBe(4);
    expect(metrics.passedOperations).toBe(4);
    expect(metrics.divergentOperations).toBe(0);
    expect(metrics.passRatePercent).toBe(100);
    expect(metrics.totalCasesTested).toBe(40);
    expect(metrics.totalDivergences).toBe(0);
    expect(metrics.genuineDivergences).toBe(0);
    expect(metrics.syntheticDivergences).toBe(0);
    expect(metrics.durationMs).toBe(120);
    expect(metrics.averageOperationDurationMs).toBe(30);
    expect(metrics.shrinking.totalFailuresShrunk).toBe(0);
  });

  it("calculates genuine divergence metrics with shrinking statistics", () => {
    const metrics = computeTelemetryMetrics(genuineDivergentReport, {
      defaultOrigin: "genuine",
      iterationsPerOperation: 5,
    });

    expect(metrics.totalOperations).toBe(3);
    expect(metrics.passedOperations).toBe(1);
    expect(metrics.divergentOperations).toBe(2);
    expect(metrics.passRatePercent).toBe(33.3);
    expect(metrics.totalDivergences).toBe(2);
    expect(metrics.genuineDivergences).toBe(2);
    expect(metrics.syntheticDivergences).toBe(0);

    // Severity Breakdown
    expect(metrics.bySeverity).toEqual({
      critical: 1,
      warning: 1,
      info: 0,
    });

    // Shrinking Metrics
    expect(metrics.shrinking.totalFailuresShrunk).toBe(2);
    expect(metrics.shrinking.totalShrinkSteps).toBe(13); // 5 + 8
    expect(metrics.shrinking.averageShrinkSteps).toBe(6.5);
    expect(metrics.shrinking.averageInputSizeReductionPercent).toBeGreaterThan(0);

    // Category breakdown
    const catMap = Object.fromEntries(metrics.byCategory.map((c) => [c.category, c.genuineCount]));
    expect(catMap["OPTIONAL_VS_NULL"]).toBe(1);
    expect(catMap["QUERY_ARRAY_ENCODING"]).toBe(1);
  });

  it("distinguishes synthetic test bugs from genuine discoveries", () => {
    const metrics = computeTelemetryMetrics(syntheticBugReport);

    expect(metrics.totalDivergences).toBe(1);
    expect(metrics.genuineDivergences).toBe(0);
    expect(metrics.syntheticDivergences).toBe(1);

    const cat = metrics.byCategory.find((c) => c.category === "CASE_CONVENTION_LEAK");
    expect(cat).toBeDefined();
    expect(cat!.syntheticCount).toBe(1);
    expect(cat!.genuineCount).toBe(0);
  });

  it("formats human-readable telemetry summary output", () => {
    const metrics = computeTelemetryMetrics(genuineDivergentReport);
    const summary = formatTelemetrySummary(metrics);

    expect(summary).toContain("WireParity Telemetry & Benchmark Metrics");
    expect(summary).toContain("Operations Covered:   1/3 (33.3% pass rate)");
    expect(summary).toContain("Total Divergences:    2");
    expect(summary).toContain("Genuine Discovered: 2");
    expect(summary).toContain("Shrinking Performance:");
    expect(summary).toContain("Failures Shrunk:   2");
    expect(summary).toContain("Divergence Breakdown by Category:");
    expect(summary).toContain("[OPTIONAL_VS_NULL]: 1");
    expect(summary).toContain("[QUERY_ARRAY_ENCODING]: 1");
  });

  it("formats machine-readable JSON metrics", () => {
    const metrics = computeTelemetryMetrics(passingReport);
    const jsonStr = formatTelemetryJson(metrics, true);

    expect(jsonStr).toContain('"passRatePercent": 100');
    expect(jsonStr).toContain('"totalOperations": 4');

    const parsed: TelemetryMetrics = JSON.parse(jsonStr);
    expect(parsed.totalOperations).toBe(4);
    expect(parsed.passRatePercent).toBe(100);
  });
});
