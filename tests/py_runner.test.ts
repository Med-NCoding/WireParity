/**
 * Tests for Step 3.4: Python SDK Runner Worker
 *
 * Verifies that fixtures/runners/py_runner.py executed as a real subprocess via SubprocessSDKRunner:
 * 1. Correctly receives IPCRequest over stdin.
 * 2. Translates OperationInputs into Python SDK method invocations (snake_case kwargs).
 * 3. Sends valid HTTP requests to the WireParity CaptureServer.
 * 4. Captures and reports success/failure back over stdout via IPCResponse.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startCaptureServer, type CaptureServer } from "../src/capture/server.js";
import { SubprocessSDKRunner } from "../src/runners/subprocess.js";
import { createOperationInputs, type OperationInputs } from "../src/ir/inputs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PY_RUNNER_SCRIPT = resolve(ROOT, "fixtures/runners/py_runner.py");

describe("Python SDK Runner Worker (py_runner.py)", () => {
  let server: CaptureServer;
  let runner: SubprocessSDKRunner;

  beforeEach(async () => {
    server = await startCaptureServer();
    runner = new SubprocessSDKRunner("python", {
      command: "python3",
      args: [PY_RUNNER_SCRIPT],
      timeoutMs: 10000,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("executes listPets with limit query parameter", async () => {
    const inputs: OperationInputs = createOperationInputs({
      queryParams: {
        limit: { kind: "integer", value: 10 },
      },
    });

    const result = await runner.sendRequest({
      operationId: "listPets",
      inputs,
      targetUrl: server.url,
    });

    expect(result.success).toBe(true);
    expect(result.language).toBe("python");

    const requests = server.getRequests();
    expect(requests).toHaveLength(1);

    const req = requests[0]!;
    expect(req.method).toBe("GET");
    expect(req.path).toBe("/pets");
    expect(req.query["limit"]).toBe("10");
  });

  it("executes listPets with status (comma-joined) and tags (repeated) and Accept-Language header", async () => {
    const inputs: OperationInputs = createOperationInputs({
      queryParams: {
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
      operationId: "listPets",
      inputs,
      targetUrl: server.url,
    });

    expect(result.success).toBe(true);

    const requests = server.getRequests();
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.method).toBe("GET");
    expect(req.path).toBe("/pets");
    // status: comma-separated (explode: false)
    expect(req.query["status"]).toBe("available,pending");
    // tags: repeated params (explode: true) → array in capture
    expect(req.query["tags"]).toEqual(["dog", "cute"]);
    expect(req.headers["accept-language"]).toBe("en-US");
  });

  it("executes createPet with JSON body", async () => {
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

  it("executes getPetById with path param and pipe-joined include query", async () => {
    const inputs: OperationInputs = createOperationInputs({
      pathParams: {
        petId: { kind: "string", value: "pet-uuid-9999" },
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
    expect(req.path).toBe("/pets/pet-uuid-9999");
    // pipeDelimited, explode: false → pipe-joined
    expect(req.query["include"]).toBe("vaccinations|owner");
  });

  it("executes updatePet with path param and JSON body", async () => {
    const inputs: OperationInputs = createOperationInputs({
      pathParams: {
        petId: { kind: "string", value: "pet-uuid-9999" },
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
    expect(req.path).toBe("/pets/pet-uuid-9999");
    expect(req.jsonBody).toEqual({ name: "Fido Updated", status: "sold" });
  });

  it("executes deletePet with path param", async () => {
    const inputs: OperationInputs = createOperationInputs({
      pathParams: {
        petId: { kind: "string", value: "pet-uuid-9999" },
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
    expect(req.path).toBe("/pets/pet-uuid-9999");
  });

  it("executes placeOrder with JSON body", async () => {
    const inputs: OperationInputs = createOperationInputs({
      body: {
        kind: "object",
        fields: {
          petId: { kind: "string", value: "pet-uuid-9999" },
          quantity: { kind: "integer", value: 2 },
        },
      },
    });

    const result = await runner.sendRequest({
      operationId: "placeOrder",
      inputs,
      targetUrl: server.url,
    });

    expect(result.success).toBe(true);

    const requests = server.getRequests();
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/store/orders");
    expect(req.jsonBody).toEqual({ petId: "pet-uuid-9999", quantity: 2 });
  });

  it("executes getOrderById with path param and X-Request-ID header", async () => {
    const inputs: OperationInputs = createOperationInputs({
      pathParams: {
        orderId: { kind: "integer", value: 42 },
      },
      headerParams: {
        "X-Request-ID": { kind: "string", value: "req-py-trace-999" },
      },
    });

    const result = await runner.sendRequest({
      operationId: "getOrderById",
      inputs,
      targetUrl: server.url,
    });

    expect(result.success).toBe(true);

    const requests = server.getRequests();
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.method).toBe("GET");
    expect(req.path).toBe("/store/orders/42");
    expect(req.headers["x-request-id"]).toBe("req-py-trace-999");
  });

  it("executes deleteOrder with path param", async () => {
    const inputs: OperationInputs = createOperationInputs({
      pathParams: {
        orderId: { kind: "integer", value: 77 },
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
    const req = requests[0]!;
    expect(req.method).toBe("DELETE");
    expect(req.path).toBe("/store/orders/77");
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
});
