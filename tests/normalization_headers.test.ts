import { describe, it, expect } from "vitest";
import { normalizeHeaders, TRANSPORT_HEADERS } from "../src/normalization/headers.js";
import type { CapturedRequest } from "../src/capture/types.js";
import type { IROperation } from "../src/ir/operations.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string | string[] | undefined>): CapturedRequest {
  return {
    id: "test-id",
    timestamp: Date.now(),
    method: "GET",
    path: "/test",
    query: {},
    headers,
    body: null,
    jsonBody: null,
  };
}

function makeOperation(headerParamNames: string[] = []): IROperation {
  return {
    id: "testOp",
    method: "GET",
    path: "/test",
    parameters: headerParamNames.map((name) => ({
      name,
      in: "header" as const,
      required: false,
      schema: { type: "string" },
    })),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("normalizeHeaders", () => {
  it("lowercases all remaining header keys", () => {
    const raw = makeRequest({ Authorization: "Bearer token", "X-Api-Key": "abc" });
    const result = normalizeHeaders(raw, makeOperation());
    expect(Object.keys(result)).toEqual(["authorization", "x-api-key"]);
  });

  it("strips all TRANSPORT_HEADERS by default", () => {
    const raw = makeRequest({
      "user-agent": "axios/1.0",
      host: "localhost:3000",
      connection: "keep-alive",
      "content-length": "42",
      "accept-encoding": "gzip",
      authorization: "Bearer token",
    });
    const result = normalizeHeaders(raw, makeOperation());
    expect(result).not.toHaveProperty("user-agent");
    expect(result).not.toHaveProperty("host");
    expect(result).not.toHaveProperty("connection");
    expect(result).not.toHaveProperty("content-length");
    expect(result).not.toHaveProperty("accept-encoding");
    expect(result).toHaveProperty("authorization", "Bearer token");
  });

  it("preserves a contract header even when it matches a transport noise name", () => {
    // If the API contract declares 'host' as a header parameter, it must be kept.
    const raw = makeRequest({ host: "api.example.com", "user-agent": "sdk/1.0" });
    const result = normalizeHeaders(raw, makeOperation(["host"]));
    expect(result).toHaveProperty("host", "api.example.com");
    // user-agent is still not in the contract, so it is dropped
    expect(result).not.toHaveProperty("user-agent");
  });

  it("collapses multi-value header arrays to comma-separated string", () => {
    const raw = makeRequest({ accept: ["application/json", "text/plain"] });
    const result = normalizeHeaders(raw, makeOperation());
    expect(result["accept"]).toBe("application/json, text/plain");
  });

  it("skips headers with undefined values", () => {
    const raw = makeRequest({ "x-optional": undefined, "content-type": "application/json" });
    const result = normalizeHeaders(raw, makeOperation());
    expect(result).not.toHaveProperty("x-optional");
    expect(result).toHaveProperty("content-type", "application/json");
  });

  it("trims whitespace from header values", () => {
    const raw = makeRequest({ "content-type": "  application/json  " });
    const result = normalizeHeaders(raw, makeOperation());
    expect(result["content-type"]).toBe("application/json");
  });

  it("returns empty object when all headers are transport noise", () => {
    const raw = makeRequest({
      "user-agent": "python-requests/2.28.0",
      host: "example.com",
      connection: "close",
      "content-length": "0",
      "accept-encoding": "gzip, deflate",
    });
    const result = normalizeHeaders(raw, makeOperation());
    expect(result).toEqual({});
  });

  it("preserves multiple contract-declared header parameters", () => {
    const raw = makeRequest({
      "x-request-id": "uuid-123",
      "x-tenant-id": "tenant-abc",
      "user-agent": "sdk",
    });
    const result = normalizeHeaders(raw, makeOperation(["x-request-id", "X-Tenant-Id"]));
    expect(result).toHaveProperty("x-request-id", "uuid-123");
    expect(result).toHaveProperty("x-tenant-id", "tenant-abc");
    expect(result).not.toHaveProperty("user-agent");
  });

  it("is case-insensitive when matching contract header names", () => {
    // Contract declares 'Authorization' (mixed case); raw has 'AUTHORIZATION'
    const raw = makeRequest({ AUTHORIZATION: "Bearer xyz" });
    const result = normalizeHeaders(raw, makeOperation(["Authorization"]));
    expect(result).toHaveProperty("authorization", "Bearer xyz");
  });
});

describe("TRANSPORT_HEADERS constant", () => {
  it("contains exactly the five mandated noise headers", () => {
    expect(TRANSPORT_HEADERS.has("user-agent")).toBe(true);
    expect(TRANSPORT_HEADERS.has("host")).toBe(true);
    expect(TRANSPORT_HEADERS.has("connection")).toBe(true);
    expect(TRANSPORT_HEADERS.has("content-length")).toBe(true);
    expect(TRANSPORT_HEADERS.has("accept-encoding")).toBe(true);
  });
});
