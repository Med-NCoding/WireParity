/**
 * Tests verifying that runner execution errors and missing HTTP requests fail loudly,
 * are counted separately from semantic divergences, and never report silent false passes.
 */

import { describe, it, expect, vi } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

import { runParitySuite } from "../src/reporter/orchestrator.js";
import { formatTerminalReport } from "../src/reporter/terminal.js";
import { formatJsonReport } from "../src/reporter/json.js";
import { MockSDKRunner } from "../src/runners/mock.js";
import { SubprocessSDKRunner } from "../src/runners/subprocess.js";
import { runCLI } from "../src/cli/index.js";
import type { IRDocument, IROperation } from "../src/ir/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TS_RUNNER_PATH = resolve(ROOT, "examples/runners/typescript/runner.ts");

function createMockDoc(operationId = "unsupportedCustomOp"): IRDocument {
  const op: IROperation = {
    id: operationId,
    method: "POST",
    path: "/custom-endpoint",
    parameters: [],
    requestBody: {
      required: false,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              field: { type: "string" },
            },
          },
        },
      },
    },
  };

  return {
    title: "Test API Spec",
    version: "1.0.0",
    servers: [],
    operations: [op],
  };
}

describe("Fail-loud execution errors and zero-request handling", () => {
  it("fails loudly when a runner returns success: false due to unsupported operationId", async () => {
    const doc = createMockDoc("unsupportedCustomOp");

    // Runner 1 supports the operation and sends a request
    const runner1 = new MockSDKRunner("typescript", async (op, inputs, targetUrl) => {
      await fetch(`${targetUrl}${op.path}`, {
        method: op.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true }),
      });
    });

    // Runner 2 fails because operationId is not supported
    const runner2 = new MockSDKRunner("python", async (op) => {
      throw new Error(`Unsupported operationId: ${op.id}`);
    });

    const report = await runParitySuite(doc, [runner1, runner2], {
      iterationsPerOperation: 2,
    });

    // Parity MUST NOT be reported as success, and execution error is not a divergence
    expect(report.totalOperations).toBe(1);
    expect(report.passedOperations).toBe(0);
    expect(report.divergentOperations).toBe(0);
    expect(report.executionErrorOperations).toBe(1);

    const result = report.results[0]!;
    expect(result.hasDivergence).toBe(false);
    expect(result.executionError).toBeDefined();
    expect(result.executionError).toContain("Runner 'python' failed: Unsupported operationId: unsupportedCustomOp");
    expect(result.diffs).toHaveLength(0);

    // Terminal report formatting check
    const terminalOutput = formatTerminalReport(report);
    expect(terminalOutput).toContain("[ERROR] Operation: unsupportedCustomOp");
    expect(terminalOutput).toContain("✖ Execution error: Runner 'python' failed: Unsupported operationId: unsupportedCustomOp");
    expect(terminalOutput).not.toContain("[PASS]");
    expect(terminalOutput).not.toContain("[FAIL]");
    expect(terminalOutput).toContain("Status: FAILED (1 execution error(s) detected)");
    expect(terminalOutput).not.toContain("divergence(s) detected");
    expect(terminalOutput).not.toContain("Status: SUCCESS (100% wire parity)");

    // JSON report formatting check
    const jsonOutput = JSON.parse(formatJsonReport(report));
    expect(jsonOutput.status).toBe("failed");
    expect(jsonOutput.summary.passedOperations).toBe(0);
    expect(jsonOutput.summary.divergentOperations).toBe(0);
    expect(jsonOutput.summary.executionErrorOperations).toBe(1);
    expect(jsonOutput.operations[0].status).toBe("error");
    expect(jsonOutput.operations[0].hasDivergence).toBe(false);
    expect(jsonOutput.operations[0].divergences).toHaveLength(0);
    expect(jsonOutput.operations[0].executionError).toContain("Unsupported operationId: unsupportedCustomOp");
  });

  it("fails loudly when a runner returns success: true but captures 0 HTTP requests", async () => {
    const doc = createMockDoc("silentNoopOp");

    // Runner 1 sends an HTTP request
    const runner1 = new MockSDKRunner("typescript", async (op, inputs, targetUrl) => {
      await fetch(`${targetUrl}${op.path}`, {
        method: op.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true }),
      });
    });

    // Runner 2 completes successfully but emits NO HTTP request (e.g. stub or no-op)
    const runner2 = new MockSDKRunner("python", async () => {
      // Intentionally does not call fetch
    });

    const report = await runParitySuite(doc, [runner1, runner2], {
      iterationsPerOperation: 2,
    });

    expect(report.totalOperations).toBe(1);
    expect(report.passedOperations).toBe(0);
    expect(report.divergentOperations).toBe(0);
    expect(report.executionErrorOperations).toBe(1);

    const result = report.results[0]!;
    expect(result.hasDivergence).toBe(false);
    expect(result.executionError).toBeDefined();
    expect(result.executionError).toContain("Runner 'python' produced no captured HTTP request for operation 'silentNoopOp'");
    expect(result.diffs).toHaveLength(0);

    const terminalOutput = formatTerminalReport(report);
    expect(terminalOutput).toContain("[ERROR] Operation: silentNoopOp");
    expect(terminalOutput).toContain("Runner 'python' produced no captured HTTP request for operation 'silentNoopOp'");
    expect(terminalOutput).not.toContain("Status: SUCCESS (100% wire parity)");
    expect(terminalOutput).toContain("Status: FAILED (1 execution error(s) detected)");
    expect(terminalOutput).not.toContain("divergence(s) detected");
  });

  it("fails loudly when all runners capture 0 HTTP requests", async () => {
    const doc = createMockDoc("allZeroOp");

    // Both runners emit zero requests
    const runner1 = new MockSDKRunner("typescript", async () => {});
    const runner2 = new MockSDKRunner("python", async () => {});

    const report = await runParitySuite(doc, [runner1, runner2], {
      iterationsPerOperation: 1,
    });

    expect(report.totalOperations).toBe(1);
    expect(report.passedOperations).toBe(0);
    expect(report.divergentOperations).toBe(0);
    expect(report.executionErrorOperations).toBe(1);

    const result = report.results[0]!;
    expect(result.hasDivergence).toBe(false);
    expect(result.executionError).toBeDefined();
    expect(result.executionError).toContain("produced no captured HTTP request");
    expect(result.diffs).toHaveLength(0);
  });

  it("fails loudly when a subprocess runner encounters an unsupported operationId", async () => {
    // examples/runners/typescript/runner.ts only supports listPets, createPet, getPetById
    const doc = createMockDoc("unsupportedExternalOp");

    const subprocessRunner = new SubprocessSDKRunner("typescript", {
      command: process.execPath,
      args: [TS_RUNNER_PATH],
      timeoutMs: 10000,
    });

    const mockPartnerRunner = new MockSDKRunner("python", async (op, inputs, targetUrl) => {
      await fetch(`${targetUrl}${op.path}`, { method: "POST" });
    });

    const report = await runParitySuite(doc, [subprocessRunner, mockPartnerRunner], {
      iterationsPerOperation: 1,
    });

    expect(report.totalOperations).toBe(1);
    expect(report.passedOperations).toBe(0);
    expect(report.divergentOperations).toBe(0);
    expect(report.executionErrorOperations).toBe(1);

    const result = report.results[0]!;
    expect(result.hasDivergence).toBe(false);
    expect(result.executionError).toBeDefined();
    expect(result.executionError).toContain("Unsupported operation: unsupportedExternalOp");
    expect(result.diffs).toHaveLength(0);
  });

  it("causes CLI to return exit code 1 when runner encounters execution error", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      // Create a temporary OpenAPI spec file with an operation unsupported by example runners
      const tempSpecPath = resolve(ROOT, "tests/fixtures_unsupported_spec.json");
      fs.writeFileSync(
        tempSpecPath,
        JSON.stringify({
          openapi: "3.0.3",
          info: { title: "Unsupported API", version: "1.0.0" },
          paths: {
            "/unsupported": {
              post: {
                operationId: "unsupportedNonExistentOp",
                responses: { "200": { description: "ok" } },
              },
            },
          },
        })
      );

      const exitCode = await runCLI([
        "--spec",
        tempSpecPath,
        "--ts",
        `node ${TS_RUNNER_PATH}`,
        "--py",
        `node ${TS_RUNNER_PATH}`,
        "--iterations",
        "1",
      ]);

      if (fs.existsSync(tempSpecPath)) {
        fs.unlinkSync(tempSpecPath);
      }

      // Exit code MUST be 1 (divergent/failed), NOT 0 (success)
      expect(exitCode).toBe(1);

      const combinedLogs = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(combinedLogs).toContain("[ERROR] Operation: unsupportedNonExistentOp");
      expect(combinedLogs).toContain("Unsupported operation: unsupportedNonExistentOp");
      expect(combinedLogs).toContain("Status: FAILED (1 execution error(s) detected)");
      expect(combinedLogs).not.toContain("Status: SUCCESS (100% wire parity)");
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("handles mixed runs containing passes, semantic divergences, and execution errors", async () => {
    const doc: IRDocument = {
      title: "Mixed API Suite",
      version: "1.0.0",
      servers: [],
      operations: [
        {
          id: "opPass",
          method: "POST",
          path: "/pass",
          parameters: [],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { type: "object", properties: { val: { type: "string" } } },
              },
            },
          },
        },
        {
          id: "opDiverge",
          method: "POST",
          path: "/diverge",
          parameters: [],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { type: "object", properties: { val: { type: "string" } } },
              },
            },
          },
        },
        {
          id: "opError",
          method: "POST",
          path: "/error",
          parameters: [],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { type: "object", properties: { val: { type: "string" } } },
              },
            },
          },
        },
      ],
    };

    const tsRunner = new MockSDKRunner("typescript", async (op, inputs, targetUrl) => {
      if (op.id === "opPass") {
        await fetch(`${targetUrl}${op.path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ match: true }),
        });
      } else if (op.id === "opDiverge") {
        // TypeScript emits JSON body
        await fetch(`${targetUrl}${op.path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "json" }),
        });
      } else if (op.id === "opError") {
        await fetch(`${targetUrl}${op.path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ok: true }),
        });
      }
    });

    const pyRunner = new MockSDKRunner("python", async (op, inputs, targetUrl) => {
      if (op.id === "opPass") {
        await fetch(`${targetUrl}${op.path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ match: true }),
        });
      } else if (op.id === "opDiverge") {
        // Python emits different body causing a semantic divergence
        await fetch(`${targetUrl}${op.path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "different" }),
        });
      } else if (op.id === "opError") {
        // Python fails with an execution error
        throw new Error("SDK network timeout or crash");
      }
    });

    const report = await runParitySuite(doc, [tsRunner, pyRunner], {
      iterationsPerOperation: 2,
    });

    // 1 pass, 1 divergence, 1 execution error
    expect(report.totalOperations).toBe(3);
    expect(report.passedOperations).toBe(1);
    expect(report.divergentOperations).toBe(1);
    expect(report.executionErrorOperations).toBe(1);

    // Operation 1: Pass
    const passItem = report.results.find((r) => r.operationId === "opPass")!;
    expect(passItem).toBeDefined();
    expect(passItem.hasDivergence).toBe(false);
    expect(passItem.executionError).toBeUndefined();
    expect(passItem.diffs).toHaveLength(0);

    // Operation 2: Semantic Divergence
    const divergeItem = report.results.find((r) => r.operationId === "opDiverge")!;
    expect(divergeItem).toBeDefined();
    expect(divergeItem.hasDivergence).toBe(true);
    expect(divergeItem.executionError).toBeUndefined();
    expect(divergeItem.diffs.length).toBeGreaterThan(0);

    // Operation 3: Execution Error
    const errorItem = report.results.find((r) => r.operationId === "opError")!;
    expect(errorItem).toBeDefined();
    expect(errorItem.hasDivergence).toBe(false);
    expect(errorItem.executionError).toContain("Runner 'python' failed: SDK network timeout or crash");
    expect(errorItem.diffs).toHaveLength(0);

    // Terminal formatting verification
    const terminalOutput = formatTerminalReport(report);
    expect(terminalOutput).toContain("[PASS] Operation: opPass");
    expect(terminalOutput).toContain("[FAIL] Operation: opDiverge");
    expect(terminalOutput).toContain("[ERROR] Operation: opError");
    expect(terminalOutput).toContain("Summary: 1/3 operations matched.");
    expect(terminalOutput).toContain("Status: FAILED (1 divergence(s) detected, 1 execution error(s) detected)");

    // JSON report verification
    const jsonOutput = JSON.parse(formatJsonReport(report));
    expect(jsonOutput.status).toBe("failed");
    expect(jsonOutput.summary.totalOperations).toBe(3);
    expect(jsonOutput.summary.passedOperations).toBe(1);
    expect(jsonOutput.summary.divergentOperations).toBe(1);
    expect(jsonOutput.summary.executionErrorOperations).toBe(1);
    expect(jsonOutput.summary.passRate).toBeCloseTo(1 / 3, 2);

    expect(jsonOutput.operations[0].operationId).toBe("opPass");
    expect(jsonOutput.operations[0].status).toBe("passed");
    expect(jsonOutput.operations[0].hasDivergence).toBe(false);

    expect(jsonOutput.operations[1].operationId).toBe("opDiverge");
    expect(jsonOutput.operations[1].status).toBe("failed");
    expect(jsonOutput.operations[1].hasDivergence).toBe(true);
    expect(jsonOutput.operations[1].divergences.length).toBeGreaterThan(0);

    expect(jsonOutput.operations[2].operationId).toBe("opError");
    expect(jsonOutput.operations[2].status).toBe("error");
    expect(jsonOutput.operations[2].hasDivergence).toBe(false);
    expect(jsonOutput.operations[2].divergences).toHaveLength(0);
    expect(jsonOutput.operations[2].executionError).toContain("SDK network timeout or crash");
  });
});
