/**
 * WireParity - Step 9.1: Terminal Parity Report Formatter Tests
 */

import { describe, it, expect } from "vitest";
import {
  formatTerminalReport,
  formatOperationItem,
  formatTerminalSummary,
  type ParityReport,
  type ParityReportItem,
} from "../src/reporter/terminal.js";

describe("Terminal Parity Report Formatter (Step 9.1)", () => {
  const passingReport: ParityReport = {
    title: "PetStore Parity Test",
    seed: "test-seed-12345",
    totalOperations: 3,
    passedOperations: 3,
    divergentOperations: 0,
    results: [
      {
        operationId: "listPets",
        hasDivergence: false,
        diffs: [],
        durationMs: 45,
      },
      {
        operationId: "createPet",
        hasDivergence: false,
        diffs: [],
        durationMs: 32,
      },
      {
        operationId: "getPetById",
        hasDivergence: false,
        diffs: [],
        durationMs: 28,
      },
    ],
  };

  const failingItem: ParityReportItem = {
    operationId: "updateUser",
    hasDivergence: true,
    diffs: [
      {
        category: "OPTIONAL_VS_NULL",
        severity: "warning",
        location: "body",
        path: "body.nickname",
        message: "Field 'body.nickname' is omitted by SDK A but sent as null by SDK B",
        expected: undefined,
        actual: null,
        sdkA: "typescript",
        sdkB: "python",
      },
      {
        category: "CASE_CONVENTION_LEAK",
        severity: "critical",
        location: "body",
        path: "body.createdAt",
        message: "Case convention leak: typescript uses 'createdAt' but python uses 'created_at'",
        expected: "createdAt",
        actual: "created_at",
        sdkA: "typescript",
        sdkB: "python",
      },
    ],
    minimizedReproducer: {
      userId: "usr_999",
      body: {
        nickname: null,
        createdAt: "2024-01-01T00:00:00Z",
      },
    },
    shrinkingSteps: 4,
    seed: 98765,
    path: "0:1:0:2",
    replayToken: "98765:0:1:0:2",
    durationMs: 88,
  };

  const failingReport: ParityReport = {
    title: "User Management API",
    seed: 98765,
    totalOperations: 2,
    passedOperations: 1,
    divergentOperations: 1,
    results: [
      {
        operationId: "getUser",
        hasDivergence: false,
        diffs: [],
        durationMs: 20,
      },
      failingItem,
    ],
  };

  it("formats 100% passing parity report with badges and summary", () => {
    const output = formatTerminalReport(passingReport);

    expect(output).toContain("WireParity Differential Parity Report");
    expect(output).toContain("Spec: PetStore Parity Test (Seed: test-seed-12345)");
    expect(output).toContain("[PASS] Operation: listPets (45ms)");
    expect(output).toContain("[PASS] Operation: createPet (32ms)");
    expect(output).toContain("[PASS] Operation: getPetById (28ms)");
    expect(output).toContain("✓ All SDKs produced semantically equivalent HTTP wire requests");
    expect(output).toContain("Summary: 3/3 operations matched.");
    expect(output).toContain("Status: SUCCESS (100% wire parity)");
  });

  it("formats report with divergences, severity tags, replay tokens, and minimal JSON reproducer", () => {
    const output = formatTerminalReport(failingReport);

    expect(output).toContain("Spec: User Management API (Seed: 98765)");
    expect(output).toContain("[PASS] Operation: getUser (20ms)");
    expect(output).toContain("[FAIL] Operation: updateUser (88ms)");
    expect(output).toContain("Found 2 divergence(s):");

    // Divergence details
    expect(output).toContain("- [OPTIONAL_VS_NULL] body.nickname (severity: warning)");
    expect(output).toContain("Explanation: Field 'body.nickname' is omitted by SDK A but sent as null by SDK B");
    expect(output).toContain("typescript: undefined");
    expect(output).toContain("python: null");

    expect(output).toContain("- [CASE_CONVENTION_LEAK] body.createdAt (severity: critical)");
    expect(output).toContain("Case convention leak");


    // Replay information
    expect(output).toContain("Replay Token: 98765:0:1:0:2");
    expect(output).toContain("Replay Path: 0:1:0:2 (Seed: 98765)");
    expect(output).toContain("Replay CLI: wireparity --seed 98765 --replay-path 0:1:0:2 --operations updateUser");

    // Minimal reproducer
    expect(output).toContain("Minimal Reproducible Input (after 4 shrink steps):");
    expect(output).toContain("```json");
    expect(output).toContain('"userId": "usr_999"');
    expect(output).toContain('"nickname": null');

    // Summary
    expect(output).toContain("Summary: 1/2 operations matched.");
    expect(output).toContain("Status: FAILED (1 divergence(s) detected)");
  });

  it("formats single operation items correctly via formatOperationItem", () => {
    const passFormatted = formatOperationItem(passingReport.results[0]!);
    expect(passFormatted).toContain("[PASS] Operation: listPets (45ms)");
    expect(passFormatted).toContain("✓ All SDKs produced semantically equivalent HTTP wire requests");

    const failFormatted = formatOperationItem(failingItem);
    expect(failFormatted).toContain("[FAIL] Operation: updateUser (88ms)");
    expect(failFormatted).toContain("[OPTIONAL_VS_NULL]");
    expect(failFormatted).toContain("Replay Token: 98765:0:1:0:2");
  });

  it("formats summary footer via formatTerminalSummary", () => {
    const passSummary = formatTerminalSummary(passingReport);
    expect(passSummary).toContain("Summary: 3/3 operations matched.");
    expect(passSummary).toContain("Status: SUCCESS (100% wire parity)");

    const failSummary = formatTerminalSummary(failingReport);
    expect(failSummary).toContain("Summary: 1/2 operations matched.");
    expect(failSummary).toContain("Status: FAILED (1 divergence(s) detected)");
  });

  it("applies ANSI colors when colors option is enabled", () => {
    const coloredPass = formatTerminalReport(passingReport, { colors: true });
    expect(coloredPass).toContain("\x1b[32m"); // Green for pass

    const coloredFail = formatTerminalReport(failingReport, { colors: true });
    expect(coloredFail).toContain("\x1b[31m"); // Red for fail
    expect(coloredFail).toContain("\x1b[33m"); // Yellow for category badge
  });
});
