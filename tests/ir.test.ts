import { describe, expect, it } from "vitest";
import {
  type IRObjectValue,
  type OperationInputs,
  createOperationInputs,
  isNullableSchema,
  isOperationInputs,
} from "../src/index.js";

describe("IR - OperationInputs & Schemas", () => {
  it("creates structured OperationInputs with separated namespaces", () => {
    const inputs: OperationInputs = createOperationInputs({
      pathParams: {
        userId: { kind: "string", value: "user_123" },
      },
      queryParams: {
        includeDetails: { kind: "boolean", value: true },
        limit: { kind: "integer", value: 10 },
      },
      headerParams: {
        "x-request-id": { kind: "string", value: "req_abc" },
      },
      cookieParams: {
        sessionId: { kind: "string", value: "sess_xyz" },
      },
      body: {
        kind: "object",
        fields: {
          name: { kind: "string", value: "Alice" },
          age: { kind: "integer", value: 30 },
        },
      },
    });

    expect(inputs.pathParams.userId).toEqual({ kind: "string", value: "user_123" });
    expect(inputs.queryParams.includeDetails).toEqual({ kind: "boolean", value: true });
    expect(inputs.queryParams.limit).toEqual({ kind: "integer", value: 10 });
    expect(inputs.headerParams["x-request-id"]).toEqual({ kind: "string", value: "req_abc" });
    expect(inputs.cookieParams?.sessionId).toEqual({ kind: "string", value: "sess_xyz" });

    const bodyObj = inputs.body as IRObjectValue;
    expect(bodyObj.kind).toBe("object");
    expect(bodyObj.fields.name).toEqual({ kind: "string", value: "Alice" });
  });

  it("provides empty defaults when created without arguments", () => {
    const inputs = createOperationInputs();

    expect(inputs.pathParams).toEqual({});
    expect(inputs.queryParams).toEqual({});
    expect(inputs.headerParams).toEqual({});
    expect(inputs.cookieParams).toEqual({});
    expect(inputs.body).toBeUndefined();
  });

  it("validates OperationInputs structure with isOperationInputs type guard", () => {
    const validInputs = createOperationInputs({
      pathParams: { id: { kind: "integer", value: 1 } },
    });
    expect(isOperationInputs(validInputs)).toBe(true);

    expect(isOperationInputs(null)).toBe(false);
    expect(isOperationInputs(undefined)).toBe(false);
    expect(isOperationInputs("string")).toBe(false);
    expect(isOperationInputs({})).toBe(false);
    expect(isOperationInputs({ pathParams: {} })).toBe(false);
  });

  it("identifies nullable schemas correctly with isNullableSchema", () => {
    expect(isNullableSchema({ type: "null" })).toBe(true);
    expect(isNullableSchema({ type: "string", nullable: true })).toBe(true);
    expect(isNullableSchema({ type: "integer", nullable: false })).toBe(false);
    expect(isNullableSchema({ type: "boolean" })).toBe(false);
  });
});
