/**
 * Tests for Step 8.2: Go SDK Runner Worker
 *
 * Verifies that fixtures/runners/go_runner.ts executed as a real subprocess via SubprocessSDKRunner:
 * 1. Correctly receives IPCRequest over stdin.
 * 2. Translates OperationInputs into Go SDK method invocations.
 * 3. Sends valid HTTP requests to the WireParity CaptureServer.
 * 4. Captures and reports success/failure back over stdout via IPCResponse.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startCaptureServer, type CaptureServer } from "../src/capture/server.js";
import { SubprocessSDKRunner } from "../src/runners/subprocess.js";
import { createOperationInputs, type OperationInputs } from "../src/ir/inputs.js";
import type { IROperation } from "../src/ir/index.js";
import { mapToGo, toPascalCase } from "../src/runners/mapping.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const GO_RUNNER_SCRIPT = resolve(ROOT, "fixtures/runners/go_runner.ts");

describe("Go SDK Runner Worker (go_runner.ts)", () => {
  let server: CaptureServer;
  let runner: SubprocessSDKRunner;

  beforeEach(async () => {
    server = await startCaptureServer();
    runner = new SubprocessSDKRunner("go", {
      command: process.execPath,
      args: [GO_RUNNER_SCRIPT],
      timeoutMs: 10000,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("executes listPets with query parameters and headers against capture server", async () => {
    const operation: IROperation = {
      id: "listPets",
      method: "GET",
      path: "/pets",
      parameters: [],
    };

    const inputs: OperationInputs = createOperationInputs({
      queryParams: {
        limit: { kind: "integer", value: 10 },
        status: {
          kind: "array",
          items: [{ kind: "string", value: "available" }, { kind: "string", value: "pending" }],
        },
        tags: {
          kind: "array",
          items: [{ kind: "string", value: "dog" }, { kind: "string", value: "cute" }],
        },
      },
      headerParams: {
        "Accept-Language": { kind: "string", value: "en-US" },
      },
    });

    const result = await runner.sendRequest({
      operationId: operation.id,
      inputs,
      targetUrl: server.url,
    });

    expect(result.success).toBe(true);
    expect(result.language).toBe("go");

    const requests = server.getRequests();
    expect(requests).toHaveLength(1);

    const req = requests[0]!;
    expect(req.method).toBe("GET");
    expect(req.path).toBe("/pets");
    expect(req.query["limit"]).toBe("10");
    expect(req.query["status"]).toBe("available,pending");
    expect(req.query["tags"]).toEqual(["dog", "cute"]);
    expect(req.headers["accept-language"]).toBe("en-US");
  });

  it("executes createPet with JSON request body", async () => {
    const inputs: OperationInputs = createOperationInputs({
      body: {
        kind: "object",
        fields: {
          name: { kind: "string", value: "Fido" },
          status: { kind: "string", value: "available" },
        },
      },
    });

    const result = await runner.sendRequest({
      operationId: "createPet",
      inputs,
      targetUrl: server.url,
    });

    expect(result.success).toBe(true);

    const requests = server.getRequests();
    expect(requests).toHaveLength(1);

    const req = requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/pets");
    expect(req.headers["content-type"]).toContain("application/json");
    expect(req.jsonBody).toEqual({ name: "Fido", status: "available" });
  });

  it("executes getPetById with path parameters and pipeDelimited query parameter", async () => {
    const inputs: OperationInputs = createOperationInputs({
      pathParams: {
        petId: { kind: "string", value: "pet-uuid-1234" },
      },
      queryParams: {
        include: {
          kind: "array",
          items: [{ kind: "string", value: "vaccinations" }, { kind: "string", value: "owner" }],
        },
      },
    });

    const result = await runner.sendRequest({
      operationId: "getPetById",
      inputs,
      targetUrl: server.url,
    });

    expect(result.success).toBe(true);

    const requests = server.getRequests();
    expect(requests).toHaveLength(1);

    const req = requests[0]!;
    expect(req.method).toBe("GET");
    expect(req.path).toBe("/pets/pet-uuid-1234");
    expect(req.query["include"]).toBe("vaccinations|owner");
  });

  it("executes updatePet with path parameters and JSON body", async () => {
    const inputs: OperationInputs = createOperationInputs({
      pathParams: {
        petId: { kind: "string", value: "pet-uuid-1234" },
      },
      body: {
        kind: "object",
        fields: {
          name: { kind: "string", value: "Fido Updated" },
          status: { kind: "string", value: "sold" },
        },
      },
    });

    const result = await runner.sendRequest({
      operationId: "updatePet",
      inputs,
      targetUrl: server.url,
    });

    expect(result.success).toBe(true);

    const requests = server.getRequests();
    expect(requests).toHaveLength(1);

    const req = requests[0]!;
    expect(req.method).toBe("PUT");
    expect(req.path).toBe("/pets/pet-uuid-1234");
    expect(req.jsonBody).toEqual({ name: "Fido Updated", status: "sold" });
  });

  it("executes deletePet with path parameters", async () => {
    const inputs: OperationInputs = createOperationInputs({
      pathParams: {
        petId: { kind: "string", value: "pet-uuid-1234" },
      },
    });

    const result = await runner.sendRequest({
      operationId: "deletePet",
      inputs,
      targetUrl: server.url,
    });

    expect(result.success).toBe(true);

    const requests = server.getRequests();
    expect(requests).toHaveLength(1);

    const req = requests[0]!;
    expect(req.method).toBe("DELETE");
    expect(req.path).toBe("/pets/pet-uuid-1234");
  });

  it("executes placeOrder and getOrderById for store endpoints", async () => {
    const orderInputs: OperationInputs = createOperationInputs({
      body: {
        kind: "object",
        fields: {
          petId: { kind: "string", value: "pet-uuid-1234" },
          quantity: { kind: "integer", value: 3 },
        },
      },
    });

    const res1 = await runner.sendRequest({
      operationId: "placeOrder",
      inputs: orderInputs,
      targetUrl: server.url,
    });
    expect(res1.success).toBe(true);

    server.clear();

    const getInputs: OperationInputs = createOperationInputs({
      pathParams: {
        orderId: { kind: "integer", value: 42 },
      },
      headerParams: {
        "X-Request-ID": { kind: "string", value: "req-trace-777" },
      },
    });

    const res2 = await runner.sendRequest({
      operationId: "getOrderById",
      inputs: getInputs,
      targetUrl: server.url,
    });
    expect(res2.success).toBe(true);

    const reqs = server.getRequests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.method).toBe("GET");
    expect(reqs[0]!.path).toBe("/store/orders/42");
    expect(reqs[0]!.headers["x-request-id"]).toBe("req-trace-777");
  });

  it("executes deleteOrder with path parameter", async () => {
    const inputs: OperationInputs = createOperationInputs({
      pathParams: {
        orderId: { kind: "integer", value: 42 },
      },
    });

    const result = await runner.sendRequest({
      operationId: "deleteOrder",
      inputs,
      targetUrl: server.url,
    });

    expect(result.success).toBe(true);

    const requests = server.getRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe("DELETE");
    expect(requests[0]!.path).toBe("/store/orders/42");
  });

  it("returns failure when targetUrl is unreachable", async () => {
    const inputs: OperationInputs = createOperationInputs();
    const result = await runner.sendRequest({
      operationId: "listPets",
      inputs,
      targetUrl: "http://127.0.0.1:59999", // closed port
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("validates Go mapping helpers", () => {
    expect(toPascalCase("pet_id")).toBe("PetId");
    expect(toPascalCase("accept-language")).toBe("AcceptLanguage");
    expect(toPascalCase("X-Request-ID")).toBe("XRequestId");

    const inputs: OperationInputs = createOperationInputs({
      pathParams: { petId: { kind: "string", value: "123" } },
      queryParams: { limit: { kind: "integer", value: 10 } },
    });
    const mapped = mapToGo("getPetById", inputs);
    expect(mapped.pathParams["petId"]).toBe("123");
    expect(mapped.requestStruct["Limit"]).toBe(10);
  });
});
