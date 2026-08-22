import { describe, expect, it } from "vitest";
import { compareRequests } from "../src/comparator/diff.js";
import type { NormalizedRequest } from "../src/normalization/types.js";

describe("Semantic Comparator & Divergence Classifier", () => {
  it("detects 0 diffs when SDKs produce identical normalized requests", () => {
    const reqTS: NormalizedRequest = {
      method: "POST",
      path: "/v1/users",
      query: { active: ["true"] },
      headers: { authorization: "Bearer secret" },
      body: { name: "Alice", age: 30 },
      rawBody: null,
    };
    const reqPY: NormalizedRequest = {
      method: "POST",
      path: "/v1/users",
      query: { active: ["true"] },
      headers: { authorization: "Bearer secret" },
      body: { name: "Alice", age: 30 },
      rawBody: null,
    };

    const res = compareRequests({ typescript: reqTS, python: reqPY });
    expect(res.hasDivergence).toBe(false);
    expect(res.diffs).toHaveLength(0);
  });

  it("detects OPTIONAL_VS_NULL divergence in JSON body", () => {
    const reqTS: NormalizedRequest = {
      method: "POST",
      path: "/users",
      query: {},
      headers: {},
      body: { nickname: null },
      rawBody: null,
    };
    const reqPY: NormalizedRequest = {
      method: "POST",
      path: "/users",
      query: {},
      headers: {},
      body: {}, // omitted
      rawBody: null,
    };

    const res = compareRequests({ typescript: reqTS, python: reqPY });
    expect(res.hasDivergence).toBe(true);
    expect(res.diffs).toHaveLength(1);
    expect(res.diffs[0].category).toBe("OPTIONAL_VS_NULL");
    expect(res.diffs[0].path).toBe("body.nickname");
  });

  it("detects QUERY_ENCODING_DIVERGENCE for array serialization differences", () => {
    const reqTS: NormalizedRequest = {
      method: "GET",
      path: "/search",
      query: { tags: ["a,b"] }, // comma delimited single entry
      headers: {},
      body: null,
      rawBody: null,
    };
    const reqPY: NormalizedRequest = {
      method: "GET",
      path: "/search",
      query: { tags: ["a", "b"] }, // multi exploded
      headers: {},
      body: null,
      rawBody: null,
    };

    const res = compareRequests({ typescript: reqTS, python: reqPY });
    expect(res.hasDivergence).toBe(true);
    expect(res.diffs).toHaveLength(1);
    expect(res.diffs[0].category).toBe("QUERY_ENCODING_DIVERGENCE");
    expect(res.diffs[0].path).toBe("query.tags");
  });

  it("detects AUTH_HEADER_SCHEME differences", () => {
    const reqTS: NormalizedRequest = {
      method: "GET",
      path: "/me",
      query: {},
      headers: { authorization: "Bearer token123" },
      body: null,
      rawBody: null,
    };
    const reqGO: NormalizedRequest = {
      method: "GET",
      path: "/me",
      query: {},
      headers: { authorization: "token123" }, // missing 'Bearer ' prefix
      body: null,
      rawBody: null,
    };

    const res = compareRequests({ typescript: reqTS, go: reqGO });
    expect(res.hasDivergence).toBe(true);
    expect(res.diffs[0].category).toBe("AUTH_HEADER_SCHEME");
  });
});
