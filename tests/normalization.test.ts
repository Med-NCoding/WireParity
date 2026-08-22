import { describe, expect, it } from "vitest";
import type { CapturedRequest } from "../src/capture/types.js";
import { normalizeRequest } from "../src/normalization/normalizer.js";

describe("Request Normalizer", () => {
  it("normalizes headers by lowercasing and stripping ignored transport headers", () => {
    const raw: CapturedRequest = {
      id: "req_1",
      timestamp: 123456789,
      method: "get",
      path: "/v1/users/",
      query: {},
      headers: {
        "User-Agent": "node-fetch/1.0",
        "Host": "localhost:8080",
        "Content-Length": "0",
        "X-Custom-Header": "custom-value",
        "Authorization": "Bearer secret-token",
      },
      body: null,
      jsonBody: null,
    };

    const normalized = normalizeRequest(raw);
    expect(normalized.method).toBe("GET");
    expect(normalized.path).toBe("/v1/users");
    expect(normalized.headers).toEqual({
      "x-custom-header": "custom-value",
      "authorization": "Bearer secret-token",
    });
    expect(normalized.headers["user-agent"]).toBeUndefined();
    expect(normalized.headers["host"]).toBeUndefined();
  });

  it("normalizes query parameters and sorts keys", () => {
    const raw: CapturedRequest = {
      id: "req_2",
      timestamp: 123456789,
      method: "GET",
      path: "/search",
      query: {
        z_index: "1",
        tags: ["beta", "alpha"],
        a_index: "0",
      },
      headers: {},
      body: null,
      jsonBody: null,
    };

    const normalized = normalizeRequest(raw);
    expect(Object.keys(normalized.query)).toEqual(["a_index", "tags", "z_index"]);
    expect(normalized.query.tags).toEqual(["beta", "alpha"]);

    const normalizedSorted = normalizeRequest(raw, { sortQueryArrays: true });
    expect(normalizedSorted.query.tags).toEqual(["alpha", "beta"]);
  });

  it("normalizes JSON bodies: sorts object keys, ISO-8601 timestamps, and preserves nulls", () => {
    const raw: CapturedRequest = {
      id: "req_3",
      timestamp: 123456789,
      method: "POST",
      path: "/orders",
      query: {},
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        z_key: "last",
        createdAt: "2026-08-21T04:00:00.000+00:00",
        a_key: "first",
        emptyVal: null,
        nested: {
          b: 2,
          a: 1,
        },
      }),
      jsonBody: {
        z_key: "last",
        createdAt: "2026-08-21T04:00:00.000+00:00",
        a_key: "first",
        emptyVal: null,
        nested: {
          b: 2,
          a: 1,
        },
      },
    };

    const normalized = normalizeRequest(raw);
    expect(normalized.body).toEqual({
      a_key: "first",
      createdAt: "2026-08-21T04:00:00.000Z",
      emptyVal: null,
      nested: {
        a: 1,
        b: 2,
      },
      z_key: "last",
    });
  });
});
