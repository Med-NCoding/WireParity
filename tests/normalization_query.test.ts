import { describe, it, expect } from "vitest";
import { normalizePathQuery } from "../src/normalization/query_path.js";
import type { CapturedRequest } from "../src/capture/types.js";
import type { IROperation } from "../src/ir/operations.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(
  path: string,
  query: Record<string, string | string[]>
): CapturedRequest {
  return {
    id: "test-id",
    timestamp: Date.now(),
    method: "GET",
    path,
    query,
    headers: {},
    body: null,
    jsonBody: null,
  };
}

function makeOperation(queryParams: Array<{ name: string; isArrayUnique?: boolean }> = []): IROperation {
  return {
    id: "testOp",
    method: "GET",
    path: "/test",
    parameters: queryParams.map(({ name, isArrayUnique }) => ({
      name,
      in: "query" as const,
      required: false,
      schema: isArrayUnique
        ? { type: "array" as const, items: { type: "string" as const }, uniqueItems: true }
        : { type: "string" as const },
    })),
  };
}

// ─── PATH tests ──────────────────────────────────────────────────────────────

describe("normalizePathQuery — path strictness", () => {
  it("preserves path exactly as received", () => {
    const raw = makeRequest("/v1/users/42", {});
    const { path } = normalizePathQuery(raw, makeOperation());
    expect(path).toBe("/v1/users/42");
  });

  it("does NOT collapse duplicate slashes", () => {
    const raw = makeRequest("/v1//users", {});
    const { path } = normalizePathQuery(raw, makeOperation());
    expect(path).toBe("/v1//users");
  });

  it("does NOT strip trailing slashes", () => {
    const raw = makeRequest("/v1/users/", {});
    const { path } = normalizePathQuery(raw, makeOperation());
    expect(path).toBe("/v1/users/");
  });

  it("preserves root slash only path", () => {
    const raw = makeRequest("/", {});
    const { path } = normalizePathQuery(raw, makeOperation());
    expect(path).toBe("/");
  });

  it("preserves path with multiple trailing slashes", () => {
    const raw = makeRequest("/a/b///", {});
    const { path } = normalizePathQuery(raw, makeOperation());
    expect(path).toBe("/a/b///");
  });
});

// ─── QUERY tests — default ordering preserved ────────────────────────────────

describe("normalizePathQuery — query ordering (default: preserve)", () => {
  it("preserves single-value query param", () => {
    const raw = makeRequest("/", { status: "active" });
    const { query } = normalizePathQuery(raw, makeOperation([{ name: "status" }]));
    expect(query["status"]).toEqual(["active"]);
  });

  it("preserves repeated param order: [b, a, c] stays [b, a, c]", () => {
    const raw = makeRequest("/", { tags: ["b", "a", "c"] });
    const { query } = normalizePathQuery(raw, makeOperation([{ name: "tags" }]));
    expect(query["tags"]).toEqual(["b", "a", "c"]);
  });

  it("does NOT sort values for a plain array param without uniqueItems", () => {
    const raw = makeRequest("/", { ids: ["3", "1", "2"] });
    const { query } = normalizePathQuery(raw, makeOperation([{ name: "ids" }]));
    expect(query["ids"]).toEqual(["3", "1", "2"]);
  });

  it("coerces a single string value into a one-element array", () => {
    const raw = makeRequest("/", { limit: "10" });
    const { query } = normalizePathQuery(raw, makeOperation([{ name: "limit" }]));
    expect(query["limit"]).toEqual(["10"]);
  });

  it("preserves multiple distinct params", () => {
    const raw = makeRequest("/", { page: "2", sort: "desc", filter: "active" });
    const { query } = normalizePathQuery(raw, makeOperation());
    expect(query["page"]).toEqual(["2"]);
    expect(query["sort"]).toEqual(["desc"]);
    expect(query["filter"]).toEqual(["active"]);
  });

  it("handles empty query gracefully", () => {
    const raw = makeRequest("/users", {});
    const { query } = normalizePathQuery(raw, makeOperation());
    expect(query).toEqual({});
  });
});

// ─── QUERY tests — set semantics (uniqueItems array params) ──────────────────

describe("normalizePathQuery — set semantics (uniqueItems array params)", () => {
  it("sorts values for contract array+uniqueItems param", () => {
    const raw = makeRequest("/", { tags: ["c", "a", "b"] });
    const { query } = normalizePathQuery(raw, makeOperation([{ name: "tags", isArrayUnique: true }]));
    expect(query["tags"]).toEqual(["a", "b", "c"]);
  });

  it("does NOT sort a param that has uniqueItems but is NOT declared in the contract", () => {
    // 'undeclared' is not in the operation parameters at all
    const raw = makeRequest("/", { undeclared: ["z", "a", "m"] });
    const { query } = normalizePathQuery(raw, makeOperation([{ name: "tags", isArrayUnique: true }]));
    expect(query["undeclared"]).toEqual(["z", "a", "m"]);
  });

  it("does NOT sort a plain string param even if another param is set-semantic", () => {
    const raw = makeRequest("/", { tags: ["c", "a"], name: ["z", "a"] });
    const op = makeOperation([
      { name: "tags", isArrayUnique: true },
      { name: "name", isArrayUnique: false }, // plain string, no uniqueItems
    ]);
    const { query } = normalizePathQuery(raw, op);
    expect(query["tags"]).toEqual(["a", "c"]);   // sorted
    expect(query["name"]).toEqual(["z", "a"]);    // NOT sorted
  });

  it("handles single-element set param (sorting is a no-op)", () => {
    const raw = makeRequest("/", { tags: ["only"] });
    const { query } = normalizePathQuery(raw, makeOperation([{ name: "tags", isArrayUnique: true }]));
    expect(query["tags"]).toEqual(["only"]);
  });
});
