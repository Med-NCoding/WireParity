import { describe, expect, it } from "vitest";
import {
  formatTerminalReport,
  MockSDKRunner,
  parseOpenAPISpec,
  runParitySuite,
} from "../src/index.js";

describe("End-to-End Differential Parity Suite", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Pet API", version: "1.0.0" },
    paths: {
      "/pets": {
        post: {
          operationId: "addPet",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string" },
                    tag: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  it("passes when SDKs produce equivalent wire requests", async () => {
    const doc = parseOpenAPISpec(spec);

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

    const report = await runParitySuite(doc, [tsRunner, pyRunner], { seed: "seed-1" });
    expect(report.divergentOperations).toBe(0);
    expect(report.passedOperations).toBe(1);

    const formatted = formatTerminalReport(report);
    expect(formatted).toContain("Status: SUCCESS (100% wire parity)");
  });

  it("detects and shrinks OPTIONAL_VS_NULL divergence across SDKs", async () => {
    const doc = parseOpenAPISpec(spec);

    // TS runner preserves explicit nulls
    const tsRunner = new MockSDKRunner("typescript", async (op, inputs, targetUrl) => {
      await fetch(`${targetUrl}${op.path}`, {
        method: op.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputs.body),
      });
    });

    // Python runner erroneously strips keys with null values
    const pyRunner = new MockSDKRunner("python", async (op, inputs, targetUrl) => {
      const bodyObj = { ...(inputs.body as Record<string, unknown>) };
      for (const [k, v] of Object.entries(bodyObj)) {
        if (v === null) delete bodyObj[k];
      }
      await fetch(`${targetUrl}${op.path}`, {
        method: op.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
      });
    });

    const report = await runParitySuite(doc, [tsRunner, pyRunner], { seed: "seed-diverge" });
    expect(report.divergentOperations).toBe(1);
    expect(report.results[0].diffs[0].category).toBe("OPTIONAL_VS_NULL");
    expect(report.results[0].minimizedReproducer).toBeDefined();

    const formatted = formatTerminalReport(report);
    expect(formatted).toContain("OPTIONAL_VS_NULL");
    expect(formatted).toContain("Status: FAILED");
  });
});
