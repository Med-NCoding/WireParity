/**
 * WireParity - Step 7.2: Query Encoding & Header Auth Classifier Tests
 */

import { describe, it, expect } from "vitest";
import {
  classifyQueryArrayEncoding,
  classifyQueryKeyNotation,
  classifyQueryValueEncoding,
  classifyQueryDivergence,
  scanQueryParams,
  isAuthHeaderName,
  parseAuthHeaderValue,
  classifyAuthHeaderDivergence,
  classifyAuthHeaderKeyMismatch,
  scanHeadersForAuthDivergences,
} from "../src/comparator/classifiers/query_and_auth.js";

// ─── Query Array Encoding Tests ───────────────────────────────────────────────

describe("classifyQueryArrayEncoding", () => {
  it("detects exploded array vs comma-joined string", () => {
    const res = classifyQueryArrayEncoding("status", ["available", "pending"], "available,pending");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("QUERY_ENCODING_DIVERGENCE");
    expect(res!.severity).toBe("critical");
    expect(res!.message).toContain("status");
    expect(res!.message).toContain("exploded");
    expect(res!.message).toContain("comma-joined");
  });

  it("detects comma-joined string vs exploded array", () => {
    const res = classifyQueryArrayEncoding("tags", "cat,dog", ["cat", "dog"]);
    expect(res).not.toBeNull();
    expect(res!.category).toBe("QUERY_ENCODING_DIVERGENCE");
    expect(res!.message).toContain("comma-joined");
    expect(res!.message).toContain("exploded");
  });

  it("detects exploded array vs single-element comma-joined array", () => {
    const res = classifyQueryArrayEncoding("tags", ["cat", "dog"], ["cat,dog"]);
    expect(res).not.toBeNull();
    expect(res!.category).toBe("QUERY_ENCODING_DIVERGENCE");
  });

  it("detects exploded array vs pipe-delimited string", () => {
    const res = classifyQueryArrayEncoding("include", ["owner", "vaccinations"], "owner|vaccinations");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("QUERY_ENCODING_DIVERGENCE");
    expect(res!.message).toContain("pipe-delimited");
  });

  it("detects pipe-delimited string vs exploded array", () => {
    const res = classifyQueryArrayEncoding("include", ["owner|vaccinations"], ["owner", "vaccinations"]);
    expect(res).not.toBeNull();
    expect(res!.category).toBe("QUERY_ENCODING_DIVERGENCE");
    expect(res!.message).toContain("pipe-delimited");
  });

  it("detects exploded array vs space-delimited string", () => {
    const res = classifyQueryArrayEncoding("scope", ["read", "write"], "read write");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("QUERY_ENCODING_DIVERGENCE");
    expect(res!.message).toContain("space-delimited");
  });

  it("detects exploded array vs plus-encoded space-delimited string", () => {
    const res = classifyQueryArrayEncoding("scope", ["read", "write"], "read+write");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("QUERY_ENCODING_DIVERGENCE");
  });

  it("detects comma-separated vs pipe-separated string delimiter mismatch", () => {
    const res = classifyQueryArrayEncoding("tags", "a,b,c", "a|b|c");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("QUERY_ENCODING_DIVERGENCE");
    expect(res!.message).toContain("delimiter mismatch");
  });

  it("detects single scalar vs single-item array wrapping", () => {
    const res = classifyQueryArrayEncoding("id", "123", ["123"]);
    expect(res).not.toBeNull();
    expect(res!.category).toBe("QUERY_ENCODING_DIVERGENCE");
    expect(res!.severity).toBe("warning");
  });

  it("detects array length mismatch", () => {
    const res = classifyQueryArrayEncoding("tags", ["a", "b", "c"], ["a", "b"]);
    expect(res).not.toBeNull();
    expect(res!.category).toBe("QUERY_ENCODING_DIVERGENCE");
  });

  it("returns null for identical values", () => {
    expect(classifyQueryArrayEncoding("status", ["available"], ["available"])).toBeNull();
    expect(classifyQueryArrayEncoding("status", "available", "available")).toBeNull();
  });

  it("returns null when either value is null or undefined", () => {
    expect(classifyQueryArrayEncoding("status", undefined, ["available"])).toBeNull();
    expect(classifyQueryArrayEncoding("status", ["available"], null)).toBeNull();
  });
});

// ─── Query Key Notation Tests ────────────────────────────────────────────────

describe("classifyQueryKeyNotation", () => {
  it("detects bracket notation divergence (tags[] vs tags)", () => {
    const res = classifyQueryKeyNotation("tags[]", "tags");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("QUERY_ENCODING_DIVERGENCE");
    expect(res!.message).toContain("tags[]");
    expect(res!.message).toContain("tags");
  });

  it("detects indexed bracket notation (ids[0] vs ids)", () => {
    const res = classifyQueryKeyNotation("ids[0]", "ids");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("QUERY_ENCODING_DIVERGENCE");
  });

  it("returns null for identical keys", () => {
    expect(classifyQueryKeyNotation("tags", "tags")).toBeNull();
    expect(classifyQueryKeyNotation("tags[]", "tags[]")).toBeNull();
  });

  it("returns null for completely unrelated keys", () => {
    expect(classifyQueryKeyNotation("tags", "limit")).toBeNull();
  });
});

// ─── Query Value Percent-Encoding Tests ───────────────────────────────────────

describe("classifyQueryValueEncoding", () => {
  it("detects space encoding variations (plus vs %20)", () => {
    const res = classifyQueryValueEncoding("filter", "hello+world", "hello%20world");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("QUERY_ENCODING_DIVERGENCE");
    expect(res!.severity).toBe("warning");
  });

  it("detects slash encoding variations (%2F vs /)", () => {
    const res = classifyQueryValueEncoding("path", "foo%2Fbar", "foo/bar");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("QUERY_ENCODING_DIVERGENCE");
  });

  it("returns null for identical string values", () => {
    expect(classifyQueryValueEncoding("name", "john", "john")).toBeNull();
  });

  it("returns null for genuinely different values", () => {
    expect(classifyQueryValueEncoding("name", "john", "jane")).toBeNull();
  });
});

// ─── classifyQueryDivergence Tests ───────────────────────────────────────────

describe("classifyQueryDivergence", () => {
  it("returns QUERY_KEY_MISSING when SDK A omits key", () => {
    const res = classifyQueryDivergence("limit", undefined, 10);
    expect(res.category).toBe("QUERY_KEY_MISSING");
    expect(res.message).toContain("omitted by SDK A");
  });

  it("returns QUERY_KEY_MISSING when SDK B omits key", () => {
    const res = classifyQueryDivergence("limit", 10, undefined);
    expect(res.category).toBe("QUERY_KEY_MISSING");
    expect(res.message).toContain("omitted by SDK B");
  });

  it("dispatches array encoding divergence", () => {
    const res = classifyQueryDivergence("status", ["a", "b"], "a,b");
    expect(res.category).toBe("QUERY_ENCODING_DIVERGENCE");
  });

  it("falls back to QUERY_VALUE_MISMATCH for general value differences", () => {
    const res = classifyQueryDivergence("limit", 10, 20);
    expect(res.category).toBe("QUERY_VALUE_MISMATCH");
  });
});

// ─── scanQueryParams Tests ───────────────────────────────────────────────────

describe("scanQueryParams", () => {
  it("scans and detects multiple query divergences", () => {
    const queryA = {
      limit: 10,
      status: ["available", "pending"],
      extra: "foo",
    };
    const queryB = {
      limit: 20,
      status: "available,pending",
      missing: "bar",
    };

    const diffs = scanQueryParams(queryA, queryB);
    expect(diffs).toHaveLength(4); // limit value mismatch, status array encoding, extra missing in B, missing missing in A
    const categories = diffs.map((d) => d.result.category);
    expect(categories).toContain("QUERY_VALUE_MISMATCH");
    expect(categories).toContain("QUERY_ENCODING_DIVERGENCE");
    expect(categories).toContain("QUERY_KEY_MISSING");
  });

  it("matches bracket notation key variations during scan", () => {
    const queryA = { tags: ["cat", "dog"] };
    const queryB = { "tags[]": ["cat", "dog"] };

    const diffs = scanQueryParams(queryA, queryB);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.result.category).toBe("QUERY_ENCODING_DIVERGENCE");
  });
});

// ─── Auth Header Helper Tests ─────────────────────────────────────────────────

describe("isAuthHeaderName", () => {
  it("identifies standard authorization headers", () => {
    expect(isAuthHeaderName("authorization")).toBe(true);
    expect(isAuthHeaderName("Authorization")).toBe(true);
    expect(isAuthHeaderName("AUTHORIZATION")).toBe(true);
    expect(isAuthHeaderName("x-api-key")).toBe(true);
    expect(isAuthHeaderName("X-API-Key")).toBe(true);
    expect(isAuthHeaderName("api-key")).toBe(true);
    expect(isAuthHeaderName("x-auth-token")).toBe(true);
  });

  it("returns false for non-auth headers", () => {
    expect(isAuthHeaderName("content-type")).toBe(false);
    expect(isAuthHeaderName("accept")).toBe(false);
    expect(isAuthHeaderName("x-request-id")).toBe(false);
  });
});

describe("parseAuthHeaderValue", () => {
  it("parses Bearer token scheme", () => {
    const res = parseAuthHeaderValue("Bearer secret123");
    expect(res.scheme).toBe("Bearer");
    expect(res.token).toBe("secret123");
    expect(res.hasExtraSpace).toBe(false);
  });

  it("parses Basic credentials scheme", () => {
    const res = parseAuthHeaderValue("Basic dXNlcjpwYXNz");
    expect(res.scheme).toBe("Basic");
    expect(res.token).toBe("dXNlcjpwYXNz");
  });

  it("flags extra whitespace between scheme and token", () => {
    const res = parseAuthHeaderValue("Bearer   secret123");
    expect(res.scheme).toBe("Bearer");
    expect(res.token).toBe("secret123");
    expect(res.hasExtraSpace).toBe(true);
  });

  it("handles raw token without scheme", () => {
    const res = parseAuthHeaderValue("raw-token-value");
    expect(res.scheme).toBeNull();
    expect(res.token).toBe("raw-token-value");
  });
});

// ─── classifyAuthHeaderDivergence Tests ───────────────────────────────────────

describe("classifyAuthHeaderDivergence", () => {
  it("detects missing Bearer prefix (Bearer <token> vs <token>)", () => {
    const res = classifyAuthHeaderDivergence("authorization", "Bearer my-token-123", "my-token-123", "TS", "Python");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("AUTH_HEADER_SCHEME");
    expect(res!.severity).toBe("critical");
    expect(res!.message).toContain("prefix missing");
    expect(res!.message).toContain("TS");
    expect(res!.message).toContain("Python");
  });

  it("detects missing Bearer prefix in reverse (SDK A sends raw token, SDK B sends Bearer)", () => {
    const res = classifyAuthHeaderDivergence("authorization", "my-token-123", "Bearer my-token-123", "TS", "Python");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("AUTH_HEADER_SCHEME");
    expect(res!.message).toContain("prefix missing");
  });

  it("detects missing Basic prefix", () => {
    const res = classifyAuthHeaderDivergence("authorization", "Basic dXNlcjpwYXNz", "dXNlcjpwYXNz");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("AUTH_HEADER_SCHEME");
    expect(res!.message).toContain("prefix missing");
  });

  it("detects scheme mismatch (Bearer vs Basic)", () => {
    const res = classifyAuthHeaderDivergence("authorization", "Bearer tok123", "Basic tok123");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("AUTH_HEADER_SCHEME");
    expect(res!.message).toContain("scheme mismatch");
    expect(res!.message).toContain("Bearer");
    expect(res!.message).toContain("Basic");
  });

  it("detects scheme casing mismatch (Bearer vs bearer)", () => {
    const res = classifyAuthHeaderDivergence("authorization", "Bearer tok123", "bearer tok123");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("AUTH_HEADER_SCHEME");
    expect(res!.message).toContain("scheme casing mismatch");
  });

  it("detects spacing irregularity (Bearer  tok vs Bearer tok)", () => {
    const res = classifyAuthHeaderDivergence("authorization", "Bearer  tok123", "Bearer tok123");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("AUTH_HEADER_SCHEME");
    expect(res!.severity).toBe("warning");
    expect(res!.message).toContain("spacing irregularity");
  });

  it("detects missing auth header (omitted vs present)", () => {
    const res = classifyAuthHeaderDivergence("authorization", undefined, "Bearer tok123");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("AUTH_HEADER_SCHEME");
    expect(res!.message).toContain("omitted");
  });

  it("detects token value mismatch under same scheme", () => {
    const res = classifyAuthHeaderDivergence("authorization", "Bearer tokA", "Bearer tokB");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("AUTH_HEADER_SCHEME");
    expect(res!.message).toContain("value mismatch");
  });

  it("returns null for non-auth header", () => {
    expect(classifyAuthHeaderDivergence("content-type", "application/json", "text/plain")).toBeNull();
  });

  it("returns null for identical auth header values", () => {
    expect(classifyAuthHeaderDivergence("authorization", "Bearer same", "Bearer same")).toBeNull();
  });
});

// ─── classifyAuthHeaderKeyMismatch Tests ──────────────────────────────────────

describe("classifyAuthHeaderKeyMismatch", () => {
  it("detects credentials sent via Authorization vs X-API-Key", () => {
    const headersA = { authorization: "Bearer secretKey" };
    const headersB = { "x-api-key": "secretKey" };

    const res = classifyAuthHeaderKeyMismatch(headersA, headersB, "TS", "Python");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("AUTH_HEADER_SCHEME");
    expect(res!.message).toContain("location divergence");
    expect(res!.message).toContain("Authorization");
    expect(res!.message).toContain("X-API-Key");
  });

  it("detects credentials sent via X-API-Key vs Authorization", () => {
    const headersA = { "x-api-key": "secretKey" };
    const headersB = { authorization: "secretKey" };

    const res = classifyAuthHeaderKeyMismatch(headersA, headersB, "TS", "Python");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("AUTH_HEADER_SCHEME");
  });

  it("returns null when no cross-header match occurs", () => {
    const headersA = { authorization: "Bearer key1" };
    const headersB = { "content-type": "application/json" };
    expect(classifyAuthHeaderKeyMismatch(headersA, headersB)).toBeNull();
  });
});

// ─── scanHeadersForAuthDivergences Tests ───────────────────────────────────────

describe("scanHeadersForAuthDivergences", () => {
  it("scans headers and identifies auth scheme divergences", () => {
    const headersA = {
      authorization: "Bearer my-secret-token",
      "content-type": "application/json",
    };
    const headersB = {
      authorization: "my-secret-token",
      "content-type": "application/json",
    };

    const diffs = scanHeadersForAuthDivergences(headersA, headersB, "TS", "Python");
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.path).toBe("headers.authorization");
    expect(diffs[0]!.result.category).toBe("AUTH_HEADER_SCHEME");
  });

  it("returns empty array when headers have no auth divergences", () => {
    const headers = {
      authorization: "Bearer secret",
      "x-api-key": "my-key",
    };
    const diffs = scanHeadersForAuthDivergences(headers, headers);
    expect(diffs).toHaveLength(0);
  });
});
