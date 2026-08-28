/**
 * Step 8.3: Three-Way Parity Matrix Integration Test (TS vs Python vs Go)
 *
 * Executes full differential parity testing across all three generated SDK runners
 * (TypeScript, Python, and Go) against the canonical PetStore OpenAPI specification,
 * asserting 100% wire parity across all operations.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
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
import { runParitySuite } from "../src/reporter/orchestrator.js";
import { formatTerminalReport } from "../src/reporter/terminal.js";
import type { IRDocument, IROperation } from "../src/ir/index.js";
import type { NormalizedRequest } from "../src/normalization/types.js";
import type { CapturedRequest } from "../src/capture/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TS_RUNNER_SCRIPT = resolve(ROOT, "fixtures/runners/ts_runner.ts");
const PY_RUNNER_SCRIPT = resolve(ROOT, "fixtures/runners/py_runner.py");
const GO_RUNNER_SCRIPT = resolve(ROOT, "fixtures/runners/go_runner.ts");
const PETSTORE_PATH = resolve(ROOT, "fixtures/specs/petstore.json");

/**
 * Normalizes a captured HTTP request against an IROperation contract.
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

describe("Three-Way Parity Matrix Test (TS vs Python vs Go)", () => {
  let ir: IRDocument;
  let tsRunner: SubprocessSDKRunner;
  let pyRunner: SubprocessSDKRunner;
  let goRunner: SubprocessSDKRunner;
  let server: CaptureServer;

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

    goRunner = new SubprocessSDKRunner("go", {
      command: process.execPath,
      args: [GO_RUNNER_SCRIPT],
      timeoutMs: 15000,
    });
  });

  beforeEach(async () => {
    server = await startCaptureServer();
  });

  afterEach(async () => {
    await server.close();
  });

  async function executeAllThree(
    operation: IROperation,
    inputs: OperationInputs
  ): Promise<Record<string, NormalizedRequest>> {
    // 1. TypeScript
    server.clear();
    const tsRes = await tsRunner.sendRequest({
      operationId: operation.id,
      inputs,
      targetUrl: server.url,
    });
    expect(tsRes.success, `TypeScript runner error: ${tsRes.error}`).toBe(true);
    const tsReqs = server.getRequests();
    expect(tsReqs).toHaveLength(1);
    const tsNorm = normalizeContractRequest(tsReqs[0]!, operation);

    // 2. Python
    server.clear();
    const pyRes = await pyRunner.sendRequest({
      operationId: operation.id,
      inputs,
      targetUrl: server.url,
    });
    expect(pyRes.success, `Python runner error: ${pyRes.error}`).toBe(true);
    const pyReqs = server.getRequests();
    expect(pyReqs).toHaveLength(1);
    const pyNorm = normalizeContractRequest(pyReqs[0]!, operation);

    // 3. Go
    server.clear();
    const goRes = await goRunner.sendRequest({
      operationId: operation.id,
      inputs,
      targetUrl: server.url,
    });
    expect(goRes.success, `Go runner error: ${goRes.error}`).toBe(true);
    const goReqs = server.getRequests();
    expect(goReqs).toHaveLength(1);
    const goNorm = normalizeContractRequest(goReqs[0]!, operation);

    return {
      typescript: tsNorm,
      python: pyNorm,
      go: goNorm,
    };
  }

  // ─── 1. Individual Operation Parity Tests ──────────────────────────────────

  it("asserts 3-way wire parity on createPet (POST /pets)", async () => {
    const operation = ir.operations.find((o) => o.id === "createPet")!;
    const inputs = createOperationInputs({
      body: {
        kind: "object",
        fields: {
          name: { kind: "string", value: "Apollo" },
          status: { kind: "string", value: "available" },
        },
      },
    });

    const requests = await executeAllThree(operation, inputs);
    const comp = compareRequests(requests);

    expect(comp.hasDivergence, `createPet divergence: ${JSON.stringify(comp.diffs, null, 2)}`).toBe(false);
    expect(requests["typescript"]!.method).toBe("POST");
    expect(requests["python"]!.method).toBe("POST");
    expect(requests["go"]!.method).toBe("POST");
  });

  it("asserts 3-way wire parity on listPets (GET /pets with query array parameters)", async () => {
    const operation = ir.operations.find((o) => o.id === "listPets")!;
    const inputs = createOperationInputs({
      queryParams: {
        limit: { kind: "integer", value: 25 },
        status: {
          kind: "array",
          items: [{ kind: "string", value: "available" }, { kind: "string", value: "pending" }],
        },
        tags: {
          kind: "array",
          items: [{ kind: "string", value: "husky" }, { kind: "string", value: "sled" }],
        },
      },
      headerParams: {
        "Accept-Language": { kind: "string", value: "en-US" },
      },
    });

    const requests = await executeAllThree(operation, inputs);
    const comp = compareRequests(requests);

    expect(comp.hasDivergence, `listPets divergence: ${JSON.stringify(comp.diffs, null, 2)}`).toBe(false);
    expect(requests["typescript"]!.query["status"]).toEqual(["available,pending"]);
    expect(requests["python"]!.query["status"]).toEqual(["available,pending"]);
    expect(requests["go"]!.query["status"]).toEqual(["available,pending"]);
  });

  it("asserts 3-way wire parity on getPetById (GET /pets/{petId} with pipeDelimited query)", async () => {
    const operation = ir.operations.find((o) => o.id === "getPetById")!;
    const inputs = createOperationInputs({
      pathParams: {
        petId: { kind: "string", value: "pet-uuid-999" },
      },
      queryParams: {
        include: {
          kind: "array",
          items: [{ kind: "string", value: "vaccinations" }, { kind: "string", value: "owner" }],
        },
      },
    });

    const requests = await executeAllThree(operation, inputs);
    const comp = compareRequests(requests);

    expect(comp.hasDivergence, `getPetById divergence: ${JSON.stringify(comp.diffs, null, 2)}`).toBe(false);
    expect(requests["typescript"]!.path).toBe("/pets/pet-uuid-999");
    expect(requests["python"]!.path).toBe("/pets/pet-uuid-999");
    expect(requests["go"]!.path).toBe("/pets/pet-uuid-999");
    expect(requests["typescript"]!.query["include"]).toEqual(["vaccinations|owner"]);
    expect(requests["python"]!.query["include"]).toEqual(["vaccinations|owner"]);
    expect(requests["go"]!.query["include"]).toEqual(["vaccinations|owner"]);
  });


  it("asserts 3-way wire parity on updatePet (PUT /pets/{petId})", async () => {
    const operation = ir.operations.find((o) => o.id === "updatePet")!;
    const inputs = createOperationInputs({
      pathParams: {
        petId: { kind: "string", value: "pet-uuid-888" },
      },
      body: {
        kind: "object",
        fields: {
          name: { kind: "string", value: "Thor Updated" },
          status: { kind: "string", value: "sold" },
        },
      },
    });

    const requests = await executeAllThree(operation, inputs);
    const comp = compareRequests(requests);

    expect(comp.hasDivergence, `updatePet divergence: ${JSON.stringify(comp.diffs, null, 2)}`).toBe(false);
    expect(requests["typescript"]!.method).toBe("PUT");
    expect(requests["python"]!.method).toBe("PUT");
    expect(requests["go"]!.method).toBe("PUT");
  });

  it("asserts 3-way wire parity on deletePet (DELETE /pets/{petId})", async () => {
    const operation = ir.operations.find((o) => o.id === "deletePet")!;
    const inputs = createOperationInputs({
      pathParams: {
        petId: { kind: "string", value: "pet-uuid-777" },
      },
    });

    const requests = await executeAllThree(operation, inputs);
    const comp = compareRequests(requests);

    expect(comp.hasDivergence, `deletePet divergence: ${JSON.stringify(comp.diffs, null, 2)}`).toBe(false);
    expect(requests["typescript"]!.method).toBe("DELETE");
    expect(requests["python"]!.method).toBe("DELETE");
    expect(requests["go"]!.method).toBe("DELETE");
  });

  it("asserts 3-way wire parity on store operations (placeOrder, getOrderById, deleteOrder)", async () => {
    // 1. placeOrder
    const placeOp = ir.operations.find((o) => o.id === "placeOrder")!;
    const orderInputs = createOperationInputs({
      body: {
        kind: "object",
        fields: {
          petId: { kind: "string", value: "pet-uuid-111" },
          quantity: { kind: "integer", value: 2 },
        },
      },
    });
    const orderReqs = await executeAllThree(placeOp, orderInputs);
    expect(compareRequests(orderReqs).hasDivergence).toBe(false);

    // 2. getOrderById
    const getOp = ir.operations.find((o) => o.id === "getOrderById")!;
    const getInputs = createOperationInputs({
      pathParams: {
        orderId: { kind: "integer", value: 505 },
      },
      headerParams: {
        "X-Request-ID": { kind: "string", value: "trace-999-xyz" },
      },
    });
    const getReqs = await executeAllThree(getOp, getInputs);
    expect(compareRequests(getReqs).hasDivergence).toBe(false);
    expect(getReqs["typescript"]!.headers["x-request-id"]).toBe("trace-999-xyz");
    expect(getReqs["python"]!.headers["x-request-id"]).toBe("trace-999-xyz");
    expect(getReqs["go"]!.headers["x-request-id"]).toBe("trace-999-xyz");

    // 3. deleteOrder
    const delOp = ir.operations.find((o) => o.id === "deleteOrder")!;
    const delInputs = createOperationInputs({
      pathParams: {
        orderId: { kind: "integer", value: 505 },
      },
    });
    const delReqs = await executeAllThree(delOp, delInputs);
    expect(compareRequests(delReqs).hasDivergence).toBe(false);
  });

  // ─── 2. Full Suite Orchestrator 3-Way Parity Test ─────────────────────────

  it("executes complete 3-way parity suite on all 8 PetStore operations asserting 100% parity", async () => {
    const report = await runParitySuite(ir, [tsRunner, pyRunner, goRunner], {
      seed: "three-way-petstore-seed",
      iterationsPerOperation: 3,
    });

    expect(report.totalOperations).toBe(8);
    expect(report.passedOperations).toBe(8);
    expect(report.divergentOperations).toBe(0);



    for (const item of report.results) {
      expect(item.hasDivergence).toBe(false);
      expect(item.diffs).toHaveLength(0);
    }

    const formatted = formatTerminalReport(report);
    expect(formatted).toContain("Status: SUCCESS (100% wire parity)");
    expect(formatted).toContain("Summary: 8/8 operations matched.");
  });
});
