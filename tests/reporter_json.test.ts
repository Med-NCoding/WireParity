/**
 * WireParity - Step 9.2: Machine-Readable JSON Report Output Tests
 */

import { describe, it, expect } from "vitest";
import {
  buildJsonReportObject,
  formatJsonReport,
  parseJsonReport,
  type StructuredJsonReport,
} from "../src/reporter/json.js";
import type { ParityReport } from "../src/reporter/terminal.js";

describe("Machine-Readable JSON Report Output (Step 9.2)", () => {
  const passingReport: ParityReport = {
    title: "PetStore OpenAPI Parity",
    seed: "global-seed-12345",
    totalOperations: 3,
    passedOperations: 3,
    divergentOperations: 0,
    results: [
      {
        operationId: "listPets",
        hasDivergence: false,
        diffs: [],
        durationMs: 40,
      },
      {
        operationId: "createPet",
        hasDivergence: false,
        diffs: [],
        durationMs: 35,
      },
      {
        operationId: "getPetById",
        hasDivergence: false,
        diffs: [],
        durationMs: 25,
      },
    ],
  };

  const failingReport: ParityReport = {
    title: "E-Commerce API Spec",
    seed: 44882,
    totalOperations: 2,
    passedOperations: 1,
    divergentOperations: 1,
    results: [
      {
        operationId: "getOrder",
        hasDivergence: false,
        diffs: [],
        durationMs: 15,
      },
      {
        operationId: "createOrder",
        hasDivergence: true,
        diffs: [
          {
            category: "QUERY_ARRAY_ENCODING",
            severity: "critical",
            location: "query",
            path: "query.filters",
            message: "Array encoding mismatch in query param 'filters'",
            expected: "a,b",
            actual: ["a", "b"],
            sdkA: "typescript",
            sdkB: "python",
          },
        ],
        minimizedReproducer: {
          queryParams: {
            filters: ["a", "b"],
          },
        },
        shrinkingSteps: 3,
        seed: 44882,
        path: "0:2:1",
        replayToken: "44882:0:2:1",
        durationMs: 92,
      },
    ],
  };

  it("builds structured JSON report object for 100% passing suite", () => {
    const fixedTime = "2026-08-27T20:00:00.000Z";
    const reportObj = buildJsonReportObject(passingReport, { timestamp: fixedTime });

    expect(reportObj.version).toBe("1.0.0");
    expect(reportObj.schemaVersion).toBe("1.0.0");
    expect(reportObj.timestamp).toBe(fixedTime);
    expect(reportObj.status).toBe("passed");
    expect(reportObj.spec.title).toBe("PetStore OpenAPI Parity");
    expect(reportObj.seed).toBe("global-seed-12345");

    // Summary metrics
    expect(reportObj.summary).toEqual({
      totalOperations: 3,
      passedOperations: 3,
      divergentOperations: 0,
      durationMs: 100,
      passRate: 1.0,
    });

    // Operations
    expect(reportObj.operations).toHaveLength(3);
    expect(reportObj.operations[0]).toEqual({
      operationId: "listPets",
      status: "passed",
      hasDivergence: false,
      durationMs: 40,
      divergences: [],
      replay: undefined,
      minimizedReproducer: undefined,
      shrinkingSteps: undefined,
    });
  });

  it("builds structured JSON report object for suite with divergences", () => {
    const fixedTime = "2026-08-27T20:00:00.000Z";
    const reportObj = buildJsonReportObject(failingReport, { timestamp: fixedTime });

    expect(reportObj.status).toBe("failed");
    expect(reportObj.summary.totalOperations).toBe(2);
    expect(reportObj.summary.passedOperations).toBe(1);
    expect(reportObj.summary.divergentOperations).toBe(1);
    expect(reportObj.summary.passRate).toBe(0.5);
    expect(reportObj.summary.durationMs).toBe(107);

    const failOp = reportObj.operations.find((o) => o.operationId === "createOrder");
    expect(failOp).toBeDefined();
    expect(failOp!.status).toBe("failed");
    expect(failOp!.hasDivergence).toBe(true);
    expect(failOp!.durationMs).toBe(92);
    expect(failOp!.shrinkingSteps).toBe(3);
    expect(failOp!.minimizedReproducer).toEqual({
      queryParams: { filters: ["a", "b"] },
    });

    // Divergence details
    expect(failOp!.divergences).toHaveLength(1);
    expect(failOp!.divergences[0]).toEqual({
      category: "QUERY_ARRAY_ENCODING",
      severity: "critical",
      location: "query",
      path: "query.filters",
      message: "Array encoding mismatch in query param 'filters'",
      expected: "a,b",
      actual: ["a", "b"],
      sdkA: "typescript",
      sdkB: "python",
    });

    // Replay instructions
    expect(failOp!.replay).toEqual({
      seed: 44882,
      path: "0:2:1",
      token: "44882:0:2:1",
      cliCommand: "wireparity --seed 44882 --replay-path 0:2:1 --operations createOrder",
    });
  });

  it("formats valid pretty-printed and compact JSON strings", () => {
    const prettyJson = formatJsonReport(failingReport, { pretty: true });
    expect(prettyJson).toContain("\n  ");
    expect(prettyJson).toContain('"schemaVersion": "1.0.0"');

    const compactJson = formatJsonReport(failingReport, { pretty: false });
    expect(compactJson).not.toContain("\n");

    const parsed: StructuredJsonReport = JSON.parse(prettyJson);
    expect(parsed.status).toBe("failed");
    expect(parsed.operations).toHaveLength(2);
  });

  it("parses and validates JSON report strings via parseJsonReport", () => {
    const jsonStr = formatJsonReport(passingReport);
    const parsed = parseJsonReport(jsonStr);

    expect(parsed.version).toBe("1.0.0");
    expect(parsed.status).toBe("passed");
    expect(parsed.summary.totalOperations).toBe(3);

    expect(() => parseJsonReport("not valid json")).toThrow();
    expect(() => parseJsonReport(JSON.stringify({ version: "2.0.0" }))).toThrow(
      "Unsupported JSON report version"
    );
    expect(() => parseJsonReport(JSON.stringify({ version: "1.0.0" }))).toThrow(
      "missing 'summary' block"
    );
    expect(() =>
      parseJsonReport(JSON.stringify({ version: "1.0.0", summary: {} }))
    ).toThrow("'operations' must be an array");
  });
});
