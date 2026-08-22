import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CaptureServer,
  compareRequests,
  type IROperation,
  MockSDKRunner,
  normalizeRequest,
  startCaptureServer,
} from "../src/index.js";

describe("SDK Runner Execution Harness", () => {
  let server: CaptureServer;

  beforeEach(async () => {
    server = await startCaptureServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("orchestrates TypeScript and Python mock runners against the capture server", async () => {
    const operation: IROperation = {
      id: "createUser",
      method: "POST",
      path: "/users",
      parameters: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", properties: { name: { type: "string" } } },
          },
        },
      },
    };

    const tsRunner = new MockSDKRunner("typescript", async (op, inputs, targetUrl) => {
      await fetch(`${targetUrl}${op.path}`, {
        method: op.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputs.body),
      });
    });

    const pyRunner = new MockSDKRunner("python", async (op, inputs, targetUrl) => {
      await fetch(`${targetUrl}${op.path}`, {
        method: op.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputs.body),
      });
    });

    const input = {
      body: {
        kind: "object" as const,
        fields: {
          name: { kind: "string" as const, value: "Bob" },
        },
      },
    };

    // Execute TS
    server.clear();
    const resTS = await tsRunner.execute(operation, input, server.url);
    expect(resTS.success).toBe(true);
    const reqTS = normalizeRequest(server.getRequests()[0]);

    // Execute Python
    server.clear();
    const resPY = await pyRunner.execute(operation, input, server.url);
    expect(resPY.success).toBe(true);
    const reqPY = normalizeRequest(server.getRequests()[0]);

    const comp = compareRequests({ typescript: reqTS, python: reqPY });
    expect(comp.hasDivergence).toBe(false);
  });
});
