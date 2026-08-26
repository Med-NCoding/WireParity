import { describe, it, expect } from "vitest";
import { compareRequests } from "../src/comparator/diff.js";
import type { NormalizedRequest } from "../src/normalization/types.js";

function makeReq(partial: Partial<NormalizedRequest> = {}): NormalizedRequest {
  return {
    method: "GET",
    path: "/pets",
    query: {},
    headers: {},
    body: null,
    rawBody: null,
    ...partial,
  };
}

describe("Structural Request Diff Comparator (Step 4.4)", () => {
  describe("Method & Path Diffs", () => {
    it("reports no divergence when requests are identical", () => {
      const reqA = makeReq({ method: "POST", path: "/pets", body: { name: "Dog" } });
      const reqB = makeReq({ method: "POST", path: "/pets", body: { name: "Dog" } });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(false);
      expect(res.diffs).toHaveLength(0);
    });

    it("detects METHOD_MISMATCH with critical severity", () => {
      const reqA = makeReq({ method: "GET" });
      const reqB = makeReq({ method: "POST" });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs).toHaveLength(1);
      expect(res.diffs[0]).toMatchObject({
        category: "METHOD_MISMATCH",
        severity: "critical",
        location: "method",
        path: "method",
        expected: "GET",
        actual: "POST",
        sdkA: "typescript",
        sdkB: "python",
      });
    });

    it("detects PATH_MISMATCH with critical severity", () => {
      const reqA = makeReq({ path: "/v1/pets/123" });
      const reqB = makeReq({ path: "/v1/pets/%7Bid%7D" });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs[0]).toMatchObject({
        category: "PATH_MISMATCH",
        severity: "critical",
        location: "path",
        path: "path",
        expected: "/v1/pets/123",
        actual: "/v1/pets/%7Bid%7D",
      });
    });
  });

  describe("Header Diffs", () => {
    it("detects HEADER_MISSING when a header is sent by only one SDK", () => {
      const reqA = makeReq({ headers: { "x-api-version": "2026-01-01" } });
      const reqB = makeReq({ headers: {} });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs[0].category).toBe("HEADER_MISSING");
      expect(res.diffs[0].path).toBe("headers.x-api-version");
    });

    it("detects HEADER_VALUE_MISMATCH", () => {
      const reqA = makeReq({ headers: { accept: "application/json" } });
      const reqB = makeReq({ headers: { accept: "application/xml" } });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs[0].category).toBe("HEADER_VALUE_MISMATCH");
      expect(res.diffs[0].path).toBe("headers.accept");
    });

    it("detects AUTH_HEADER_SCHEME differences with critical severity", () => {
      const reqA = makeReq({ headers: { authorization: "Bearer secret-token" } });
      const reqB = makeReq({ headers: { authorization: "secret-token" } });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs[0]).toMatchObject({
        category: "AUTH_HEADER_SCHEME",
        severity: "critical",
        path: "headers.authorization",
      });
    });
  });

  describe("Query Parameter Diffs", () => {
    it("detects QUERY_KEY_MISSING", () => {
      const reqA = makeReq({ query: { limit: ["10"], offset: ["0"] } });
      const reqB = makeReq({ query: { limit: ["10"] } });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs[0]).toMatchObject({
        category: "QUERY_KEY_MISSING",
        path: "query.offset",
      });
    });

    it("detects QUERY_ENCODING_DIVERGENCE for array formatting differences", () => {
      const reqA = makeReq({ query: { status: ["available,pending"] } });
      const reqB = makeReq({ query: { status: ["available", "pending"] } });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs[0]).toMatchObject({
        category: "QUERY_ENCODING_DIVERGENCE",
        path: "query.status",
      });
    });

    it("detects QUERY_VALUE_MISMATCH", () => {
      const reqA = makeReq({ query: { filter: ["active"] } });
      const reqB = makeReq({ query: { filter: ["inactive"] } });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs[0]).toMatchObject({
        category: "QUERY_VALUE_MISMATCH",
        path: "query.filter",
      });
    });
  });

  describe("JSON Body Diffs", () => {
    it("detects BODY_MISSING when one SDK omits request body", () => {
      const reqA = makeReq({ body: { name: "Fluffy" } });
      const reqB = makeReq({ body: null });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs[0]).toMatchObject({
        category: "BODY_MISSING",
        path: "body",
      });
    });

    it("detects OPTIONAL_VS_NULL divergence", () => {
      const reqA = makeReq({ body: { id: 1, tag: null } });
      const reqB = makeReq({ body: { id: 1 } });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs[0]).toMatchObject({
        category: "OPTIONAL_VS_NULL",
        path: "body.tag",
      });
    });

    it("detects deeply nested property mismatches with accurate path string", () => {
      const reqA = makeReq({
        body: {
          user: {
            profile: {
              age: 25,
            },
          },
        },
      });
      const reqB = makeReq({
        body: {
          user: {
            profile: {
              age: 30,
            },
          },
        },
      });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs[0]).toMatchObject({
        category: "BODY_PROPERTY_MISMATCH",
        path: "body.user.profile.age",
        expected: 25,
        actual: 30,
      });
    });

    it("detects array element mismatch with index path", () => {
      const reqA = makeReq({ body: { tags: ["cat", "dog"] } });
      const reqB = makeReq({ body: { tags: ["cat", "fish"] } });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs[0]).toMatchObject({
        path: "body.tags[1]",
        expected: "dog",
        actual: "fish",
      });
    });

    it("detects ENUM_SERIALIZATION_ERROR for case discrepancies", () => {
      const reqA = makeReq({ body: { status: "AVAILABLE" } });
      const reqB = makeReq({ body: { status: "available" } });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs[0]).toMatchObject({
        category: "ENUM_SERIALIZATION_ERROR",
        path: "body.status",
      });
    });

    it("detects DATETIME_FORMAT_MISMATCH between epoch and ISO string", () => {
      const reqA = makeReq({ body: { timestamp: "2026-08-26T12:00:00.000Z" } });
      const reqB = makeReq({ body: { timestamp: 1787745600000 } });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs[0]).toMatchObject({
        category: "DATETIME_FORMAT_MISMATCH",
        path: "body.timestamp",
      });
    });

    it("detects BODY_TYPE_MISMATCH", () => {
      const reqA = makeReq({ body: { id: 123 } });
      const reqB = makeReq({ body: { id: "123" } });

      const res = compareRequests({ typescript: reqA, python: reqB });
      expect(res.hasDivergence).toBe(true);
      expect(res.diffs[0]).toMatchObject({
        category: "BODY_TYPE_MISMATCH",
        path: "body.id",
      });
    });
  });

  describe("Multi-SDK Comparison", () => {
    it("compares 3 SDKs pairwise against baseline", () => {
      const reqTS = makeReq({ body: { count: 1 } });
      const reqPY = makeReq({ body: { count: 2 } });
      const reqGO = makeReq({ body: { count: 1 } });

      const res = compareRequests({
        typescript: reqTS,
        python: reqPY,
        go: reqGO,
      });

      expect(res.hasDivergence).toBe(true);
      expect(res.diffs).toHaveLength(1);
      expect(res.diffs[0]).toMatchObject({
        sdkA: "typescript",
        sdkB: "python",
        path: "body.count",
      });
    });
  });
});
