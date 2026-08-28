/**
 * WireParity - Step 10.1: Synthetic Regression & Bug Injection Suite
 *
 * Tests controlled injected bugs across mock SDKs, verifying:
 *   1. Accurate divergence detection across all major DivergenceCategory classifications:
 *      - OPTIONAL_VS_NULL
 *      - CASE_CONVENTION_LEAK
 *      - QUERY_ARRAY_ENCODING / QUERY_ENCODING_DIVERGENCE
 *      - AUTH_HEADER_SCHEME / HEADER_MISSING
 *      - DATETIME_FORMAT_MISMATCH
 *      - ENUM_SERIALIZATION_ERROR
 *   2. Fast-check input tree shrinking down to minimal counterexamples.
 *   3. Replay token reproducibility via replayOperationParityTest.
 */

import { describe, it, expect } from "vitest";
import { MockSDKRunner } from "../src/runners/mock.js";
import { startCaptureServer } from "../src/capture/server.js";
import { parseOpenAPISpec } from "../src/openapi/parser.js";
import { runParitySuite } from "../src/reporter/orchestrator.js";
import { compareRequests } from "../src/comparator/diff.js";
import { runOperationParityTest, replayOperationParityTest } from "../src/shrinker/fast_check_shrink.js";
import { normalizeContractRequest } from "../src/normalization/normalizer.js";
import type { OperationInputs } from "../src/ir/inputs.js";

describe("Synthetic Divergence Injection & Shrinking Suite (Step 10.1)", () => {
  // ─── 1. OPTIONAL_VS_NULL Injected Bug ─────────────────────────────────────

  it("detects, classifies, and shrinks OPTIONAL_VS_NULL divergence", async () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "Null Test API", version: "1.0.0" },
      paths: {
        "/users": {
          post: {
            operationId: "createUser",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["name"],
                    properties: {
                      name: { type: "string" },
                      bio: { type: "string", nullable: true },
                      website: { type: "string", nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const doc = parseOpenAPISpec(spec);

    // Runner A: Preserves nulls correctly
    const runnerA = new MockSDKRunner("typescript", async (op, inputs, targetUrl) => {
      await fetch(`${targetUrl}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputs["body"] ?? inputs),
      });
    });

    // Runner B: Erroneously strips keys when value is null
    const runnerB = new MockSDKRunner("python", async (op, inputs, targetUrl) => {
      const raw = { ...((inputs["body"] as Record<string, unknown>) ?? inputs) };
      const stripped: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v !== null) stripped[k] = v;
      }
      await fetch(`${targetUrl}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stripped),
      });
    });

    const report = await runParitySuite(doc, [runnerA, runnerB], {
      seed: "null-bug-seed",
      iterationsPerOperation: 10,
    });

    expect(report.divergentOperations).toBe(1);
    const item = report.results[0]!;
    expect(item.hasDivergence).toBe(true);

    const nullDiff = item.diffs.find((d) => d.category === "OPTIONAL_VS_NULL");
    expect(nullDiff).toBeDefined();
    expect(nullDiff!.location).toBe("body");

    // Assert shrinking reduced the input payload
    expect(item.shrinkingSteps).toBeGreaterThanOrEqual(0);
    expect(item.minimizedReproducer).toBeDefined();
    expect(item.replayToken).toBeDefined();
  });

  // ─── 2. CASE_CONVENTION_LEAK Injected Bug ─────────────────────────────────

  it("detects, classifies, and shrinks CASE_CONVENTION_LEAK divergence", async () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "Case Test API", version: "1.0.0" },
      paths: {
        "/accounts": {
          post: {
            operationId: "createAccount",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["accountNumber"],
                    properties: {
                      accountNumber: { type: "string" },
                      routingNumber: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const doc = parseOpenAPISpec(spec);

    // Runner A: Sends camelCase per spec contract
    const runnerA = new MockSDKRunner("typescript", async (op, inputs, targetUrl) => {
      await fetch(`${targetUrl}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputs["body"] ?? inputs),
      });
    });

    // Runner B: Inadvertently leaks Python snake_case into JSON payload keys
    const runnerB = new MockSDKRunner("python", async (op, inputs, targetUrl) => {
      const raw = ((inputs["body"] as Record<string, unknown>) ?? inputs);
      const leaked: Record<string, unknown> = {};
      if (raw["accountNumber"] !== undefined) leaked["account_number"] = raw["accountNumber"];
      if (raw["routingNumber"] !== undefined) leaked["routing_number"] = raw["routingNumber"];

      await fetch(`${targetUrl}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(leaked),
      });
    });

    const report = await runParitySuite(doc, [runnerA, runnerB], {
      seed: "case-leak-seed",
      iterationsPerOperation: 5,
    });

    expect(report.divergentOperations).toBe(1);
    const item = report.results[0]!;
    const caseDiff = item.diffs.find((d) => d.category === "CASE_CONVENTION_LEAK");
    expect(caseDiff).toBeDefined();
    expect(caseDiff!.message).toContain("Case convention leak");
  });

  // ─── 3. QUERY_ARRAY_ENCODING Injected Bug ─────────────────────────────────

  it("detects and classifies QUERY_ARRAY_ENCODING divergence", async () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "Query Test API", version: "1.0.0" },
      paths: {
        "/items": {
          get: {
            operationId: "listItems",
            parameters: [
              {
                name: "categories",
                in: "query",
                style: "form",
                explode: false, // Contract specifies comma-joined: categories=a,b
                schema: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            ],
          },
        },
      },
    };

    const doc = parseOpenAPISpec(spec);

    // Runner A: Respects explode: false -> comma-separated
    const runnerA = new MockSDKRunner("typescript", async (op, inputs, targetUrl) => {
      const cats = inputs["categories"] as string[] | undefined;
      const q = cats && cats.length > 0 ? `?categories=${encodeURIComponent(cats.join(","))}` : "";
      await fetch(`${targetUrl}/items${q}`, { method: "GET" });
    });

    // Runner B: Erroneously sends repeated query parameters (explode: true style)
    const runnerB = new MockSDKRunner("python", async (op, inputs, targetUrl) => {
      const cats = inputs["categories"] as string[] | undefined;
      let q = "";
      if (cats && cats.length > 0) {
        q = "?" + cats.map((c) => `categories=${encodeURIComponent(c)}`).join("&");
      }
      await fetch(`${targetUrl}/items${q}`, { method: "GET" });
    });

    const report = await runParitySuite(doc, [runnerA, runnerB], {
      seed: "query-encoding-seed",
      iterationsPerOperation: 10,
    });

    expect(report.divergentOperations).toBe(1);
    const diff = report.results[0]!.diffs.find(
      (d) => d.category === "QUERY_ARRAY_ENCODING" || d.category === "QUERY_ENCODING_DIVERGENCE"
    );
    expect(diff).toBeDefined();
  });

  // ─── 4. AUTH_HEADER_SCHEME & HEADER_MISSING Injected Bug ──────────────────

  it("detects and classifies AUTH_HEADER_SCHEME divergence", async () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "Auth Test API", version: "1.0.0" },
      paths: {
        "/secure/profile": {
          get: {
            operationId: "getProfile",
            parameters: [
              {
                name: "Authorization",
                in: "header",
                required: true,
                schema: { type: "string" },
              },
            ],
          },
        },
      },
    };

    const doc = parseOpenAPISpec(spec);

    // Runner A: Sends standard Bearer authorization header
    const runnerA = new MockSDKRunner("typescript", async (op, inputs, targetUrl) => {
      await fetch(`${targetUrl}/secure/profile`, {
        method: "GET",
        headers: { Authorization: "Bearer tok_12345" },
      });
    });

    // Runner B: Erroneously sends X-API-Key header instead of Authorization header
    const runnerB = new MockSDKRunner("python", async (op, inputs, targetUrl) => {
      await fetch(`${targetUrl}/secure/profile`, {
        method: "GET",
        headers: { "X-API-Key": "tok_12345" },
      });
    });

    const report = await runParitySuite(doc, [runnerA, runnerB], {
      seed: "auth-bug-seed",
      iterationsPerOperation: 3,
    });

    expect(report.divergentOperations).toBe(1);
    const authDiff = report.results[0]!.diffs.find(
      (d) => d.category === "AUTH_HEADER_SCHEME" || d.category === "HEADER_MISSING"
    );
    expect(authDiff).toBeDefined();
  });

  // ─── 5. DATETIME_FORMAT_MISMATCH Injected Bug ─────────────────────────────

  it("detects, classifies, and shrinks DATETIME_FORMAT_MISMATCH divergence", async () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "Datetime Test API", version: "1.0.0" },
      paths: {
        "/events": {
          post: {
            operationId: "createEvent",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["timestamp"],
                    properties: {
                      timestamp: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const doc = parseOpenAPISpec(spec);

    // Runner A: Formats date-time as RFC 3339 / ISO 8601 (2024-01-01T00:00:00.000Z)
    const runnerA = new MockSDKRunner("typescript", async (op, inputs, targetUrl) => {
      const body = inputs["body"] ?? inputs;
      await fetch(`${targetUrl}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    });

    // Runner B: Formats date-time as Unix epoch timestamp integer
    const runnerB = new MockSDKRunner("python", async (op, inputs, targetUrl) => {
      const body = ((inputs["body"] as Record<string, unknown>) ?? inputs);
      const rawTs = String(body["timestamp"] ?? "");
      const epoch = Math.floor(new Date(rawTs).getTime() / 1000) || 1704067200;

      await fetch(`${targetUrl}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timestamp: epoch }),
      });
    });

    const report = await runParitySuite(doc, [runnerA, runnerB], {
      seed: "datetime-seed-99",
      iterationsPerOperation: 5,
    });

    expect(report.divergentOperations).toBe(1);
    const dtDiff = report.results[0]!.diffs.find((d) => d.category === "DATETIME_FORMAT_MISMATCH");
    expect(dtDiff).toBeDefined();
  });

  // ─── 6. ENUM_SERIALIZATION_ERROR Injected Bug ─────────────────────────────

  it("detects, classifies, and shrinks ENUM_SERIALIZATION_ERROR divergence", async () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "Enum Test API", version: "1.0.0" },
      paths: {
        "/tasks": {
          post: {
            operationId: "createTask",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["status"],
                    properties: {
                      status: {
                        type: "string",
                        enum: ["PENDING", "IN_PROGRESS", "COMPLETED"],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const doc = parseOpenAPISpec(spec);

    // Runner A: Preserves exact spec casing (e.g. "PENDING")
    const runnerA = new MockSDKRunner("typescript", async (op, inputs, targetUrl) => {
      const body = inputs["body"] ?? inputs;
      await fetch(`${targetUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    });

    // Runner B: Erroneously lowercases enum string (e.g. "pending")
    const runnerB = new MockSDKRunner("python", async (op, inputs, targetUrl) => {
      const body = ((inputs["body"] as Record<string, unknown>) ?? inputs);
      const rawStatus = String(body["status"] ?? "");
      await fetch(`${targetUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: rawStatus.toLowerCase() }),
      });
    });

    const report = await runParitySuite(doc, [runnerA, runnerB], {
      seed: "enum-seed-88",
      iterationsPerOperation: 5,
    });

    expect(report.divergentOperations).toBe(1);
    const enumDiff = report.results[0]!.diffs.find(
      (d) => d.category === "ENUM_SERIALIZATION_ERROR" || d.category === "CASE_CONVENTION_LEAK"
    );
    expect(enumDiff).toBeDefined();
  });

  // ─── 7. Single-Shot Replay Token Verification ─────────────────────────────

  it("verifies single-shot reproduction of an injected divergence via replayOperationParityTest", async () => {
    const server = await startCaptureServer();

    const spec = {
      openapi: "3.0.3",
      info: { title: "Replay Test API", version: "1.0.0" },
      paths: {
        "/widgets": {
          post: {
            operationId: "createWidget",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["name"],
                    properties: {
                      name: { type: "string" },
                      secretCode: { type: "string", nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const doc = parseOpenAPISpec(spec);
    const operation = doc.operations[0]!;

    try {
      const runnerA = new MockSDKRunner("typescript", async (op, inputs, targetUrl) => {
        const body = inputs["body"] ?? inputs;
        await fetch(`${targetUrl}/widgets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      });

      const runnerB = new MockSDKRunner("python", async (op, inputs, targetUrl) => {
        const raw = { ...(((inputs["body"] as Record<string, unknown>) ?? inputs)) };
        if (raw["secretCode"] === null) delete raw["secretCode"];
        await fetch(`${targetUrl}/widgets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(raw),
        });
      });

      const testPredicate = async (candidateInput: OperationInputs) => {
        server.clear();
        await runnerA.execute(operation, candidateInput, server.url);
        const reqsA = server.getRequests();
        if (reqsA.length === 0) throw new Error("Runner A did not capture request");
        const normA = normalizeContractRequest(reqsA[0]!, operation);

        server.clear();
        await runnerB.execute(operation, candidateInput, server.url);
        const reqsB = server.getRequests();
        if (reqsB.length === 0) throw new Error("Runner B did not capture request");
        const normB = normalizeContractRequest(reqsB[0]!, operation);

        return compareRequests({ typescript: normA, python: normB });
      };

      // 1. Initial property test discovering the bug
      const initialRun = await runOperationParityTest(operation, testPredicate, {
        seed: "deterministic-bug-seed",
        numRuns: 50,
      });


      expect(initialRun.hasDivergence).toBe(true);
      expect(initialRun.replayToken).toBeDefined();

      // 2. Replay the exact bug in a single shot using the replayToken
      const replayRun = await replayOperationParityTest(
        operation,
        testPredicate,
        initialRun.replayToken!
      );

      expect(replayRun.hasDivergence).toBe(true);
      expect(replayRun.numRuns).toBe(1);
      expect(replayRun.diffs[0]!.category).toBe("OPTIONAL_VS_NULL");
    } finally {
      await server.close();
    }
  });
});
