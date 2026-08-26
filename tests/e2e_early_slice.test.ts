/**
 * Step 5.1: Early TS vs Python Differential Integration Test
 *
 * End-to-end vertical slice:
 *   1. Parse petstore.json via parseOpenAPISpec
 *   2. Invoke real generated TS SDK (ts_runner.ts) and Python SDK (py_runner.py)
 *      on the two focus operations: createPet (POST /pets) and listPets (GET /pets)
 *   3. Capture the actual HTTP requests sent to a WireParity CaptureServer
 *   4. Normalize each captured request against the IROperation contract
 *   5. Compare normalized requests with compareRequests
 *   6. Assert 100% wire parity — no SemanticDiff divergences
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseOpenAPISpec } from "../src/openapi/parser.js";
import { startCaptureServer, type CaptureServer } from "../src/capture/server.js";
import { SubprocessSDKRunner } from "../src/runners/subprocess.js";
import { createOperationInputs, type OperationInputs } from "../src/ir/inputs.js";
import { normalizeHeaders } from "../src/normalization/headers.js";
import { normalizePathQuery } from "../src/normalization/query_path.js";
import { normalizeBody } from "../src/normalization/body.js";
import { compareRequests } from "../src/comparator/diff.js";
import type { IRDocument, IROperation } from "../src/ir/index.js";
import type { NormalizedRequest } from "../src/normalization/types.js";
import type { CapturedRequest } from "../src/capture/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TS_RUNNER_SCRIPT = resolve(ROOT, "fixtures/runners/ts_runner.ts");
const PY_RUNNER_SCRIPT = resolve(ROOT, "fixtures/runners/py_runner.py");
const PETSTORE_PATH = resolve(ROOT, "fixtures/specs/petstore.json");

/**
 * Fully normalizes a captured request against the IR operation contract,
 * combining all three Phase 4 normalizers:
 *   - normalizeHeaders  (Step 4.1)
 *   - normalizePathQuery (Step 4.2)
 *   - normalizeBody     (Step 4.3)
 */
function normalizeContractRequest(raw: CapturedRequest, operation: IROperation): NormalizedRequest {
  const headers = normalizeHeaders(raw, operation);
  const { path, query } = normalizePathQuery(raw, operation);
  const { body, rawBody } = normalizeBody(raw, operation);
  return {
    method: raw.method.toUpperCase(),
    path,
    query,
    headers,
    body,
    rawBody,
  };
}

// ─── Shared state ───────────────────────────────────────────────────────────

let ir: IRDocument;
let tsRunner: SubprocessSDKRunner;
let pyRunner: SubprocessSDKRunner;

beforeAll(() => {
  const raw = JSON.parse(readFileSync(PETSTORE_PATH, "utf-8"));
  ir = parseOpenAPISpec(raw);

  tsRunner = new SubprocessSDKRunner("typescript", {
    command: process.execPath,
    args: [TS_RUNNER_SCRIPT],
    timeoutMs: 15000,
  });

  pyRunner = new SubprocessSDKRunner("python", {
    command: "python3",
    args: [PY_RUNNER_SCRIPT],
    timeoutMs: 15000,
  });
});

// ─── Helper ─────────────────────────────────────────────────────────────────

async function runBothSDKs(
  operation: IROperation,
  inputs: OperationInputs,
  server: CaptureServer
): Promise<{ ts: NormalizedRequest; py: NormalizedRequest }> {
  // TypeScript SDK
  server.clear();
  const tsResult = await tsRunner.sendRequest({
    operationId: operation.id,
    inputs,
    targetUrl: server.url,
  });
  expect(tsResult.success, `TS runner failed: ${tsResult.error}`).toBe(true);
  const tsReqs = server.getRequests();
  expect(tsReqs).toHaveLength(1);
  const tsNorm = normalizeContractRequest(tsReqs[0]!, operation);

  // Python SDK
  server.clear();
  const pyResult = await pyRunner.sendRequest({
    operationId: operation.id,
    inputs,
    targetUrl: server.url,
  });
  expect(pyResult.success, `PY runner failed: ${pyResult.error}`).toBe(true);
  const pyReqs = server.getRequests();
  expect(pyReqs).toHaveLength(1);
  const pyNorm = normalizeContractRequest(pyReqs[0]!, operation);

  return { ts: tsNorm, py: pyNorm };
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("Early TS vs Python Differential E2E Slice (Step 5.1)", () => {
  let server: CaptureServer;

  beforeEach(async () => {
    server = await startCaptureServer();
  });

  afterEach(async () => {
    await server.close();
  });

  // ── createPet (POST /pets) ────────────────────────────────────────────────

  describe("createPet (POST /pets)", () => {
    let operation: IROperation;

    beforeAll(() => {
      const op = ir.operations.find((o) => o.id === "createPet");
      if (!op) throw new Error("createPet not found in petstore IR");
      operation = op;
    });

    it("produces identical wire requests for a minimal pet body (name only)", async () => {
      const inputs = createOperationInputs({
        body: {
          kind: "object",
          fields: {
            name: { kind: "string", value: "Fido" },
          },
        },
      });

      const { ts, py } = await runBothSDKs(operation, inputs, server);

      const result = compareRequests({ typescript: ts, python: py });
      expect(
        result.hasDivergence,
        `Unexpected divergence on createPet (name-only): ${JSON.stringify(result.diffs, null, 2)}`
      ).toBe(false);

      // Structural sanity checks
      expect(ts.method).toBe("POST");
      expect(ts.path).toBe("/pets");
      expect(py.method).toBe("POST");
      expect(py.path).toBe("/pets");
    });

    it("produces identical wire requests for a full pet body (name + status)", async () => {
      const inputs = createOperationInputs({
        body: {
          kind: "object",
          fields: {
            name: { kind: "string", value: "Whiskers" },
            status: { kind: "string", value: "available" },
          },
        },
      });

      const { ts, py } = await runBothSDKs(operation, inputs, server);

      const result = compareRequests({ typescript: ts, python: py });
      expect(
        result.hasDivergence,
        `Unexpected divergence on createPet (full): ${JSON.stringify(result.diffs, null, 2)}`
      ).toBe(false);
    });
  });

  // ── listPets (GET /pets) ──────────────────────────────────────────────────

  describe("listPets (GET /pets)", () => {
    let operation: IROperation;

    beforeAll(() => {
      const op = ir.operations.find((o) => o.id === "listPets");
      if (!op) throw new Error("listPets not found in petstore IR");
      operation = op;
    });

    it("produces identical wire requests with no query parameters (explicit Accept-Language)", async () => {
      // Accept-Language is declared as a contract header on listPets. Node.js undici fetch
      // injects 'accept-language: *' by default on GET requests; Python urllib does not.
      // We explicitly provide it so both runners forward the same value, testing parity
      // of the SDK's header forwarding rather than the runtime default injection.
      const inputs = createOperationInputs({
        headerParams: {
          "Accept-Language": { kind: "string", value: "en-US" },
        },
      });

      const { ts, py } = await runBothSDKs(operation, inputs, server);

      const result = compareRequests({ typescript: ts, python: py });
      expect(
        result.hasDivergence,
        `Unexpected divergence on listPets (no params): ${JSON.stringify(result.diffs, null, 2)}`
      ).toBe(false);

      expect(ts.method).toBe("GET");
      expect(ts.path).toBe("/pets");
    });

    it("produces identical wire requests with a limit query parameter", async () => {
      const inputs = createOperationInputs({
        queryParams: {
          limit: { kind: "integer", value: 10 },
        },
        headerParams: {
          "Accept-Language": { kind: "string", value: "en-US" },
        },
      });

      const { ts, py } = await runBothSDKs(operation, inputs, server);

      const result = compareRequests({ typescript: ts, python: py });
      expect(
        result.hasDivergence,
        `Unexpected divergence on listPets (limit): ${JSON.stringify(result.diffs, null, 2)}`
      ).toBe(false);
    });
  });
});
