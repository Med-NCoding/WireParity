import { describe, it, expect } from "vitest";
import { normalizeJsonBody, normalizeBody } from "../src/normalization/body.js";
import type { CapturedRequest } from "../src/capture/types.js";
import type { IROperation } from "../src/ir/operations.js";
import type { IRObjectSchema } from "../src/ir/values.js";

describe("Canonical JSON Body Normalizer (Step 4.3)", () => {
  describe("normalizeJsonBody - Key Sorting", () => {
    it("recursively sorts object keys alphabetically", () => {
      const input = {
        z: 1,
        b: {
          y: 2,
          a: 3,
        },
        a: "hello",
      };

      const result = normalizeJsonBody(input) as Record<string, unknown>;
      expect(Object.keys(result)).toEqual(["a", "b", "z"]);
      expect(Object.keys(result.b as Record<string, unknown>)).toEqual(["a", "y"]);
    });

    it("sorts keys inside objects contained within arrays", () => {
      const input = [
        { d: 4, c: 3 },
        { b: 2, a: 1 },
      ];

      const result = normalizeJsonBody(input) as Array<Record<string, unknown>>;
      expect(Object.keys(result[0])).toEqual(["c", "d"]);
      expect(Object.keys(result[1])).toEqual(["a", "b"]);
    });
  });

  describe("normalizeJsonBody - Number & -0 Normalization", () => {
    it("converts -0 to 0", () => {
      const negZero = -0;
      const result = normalizeJsonBody(negZero);
      expect(Object.is(result, 0)).toBe(true);
      expect(Object.is(result, -0)).toBe(false);
    });

    it("converts -0 within objects and arrays to 0", () => {
      const input = {
        val: -0,
        list: [1, -0, 3],
      };

      const result = normalizeJsonBody(input) as { val: number; list: number[] };
      expect(Object.is(result.val, 0)).toBe(true);
      expect(Object.is(result.list[1], 0)).toBe(true);
    });

    it("preserves positive, negative, and floating point numbers", () => {
      expect(normalizeJsonBody(42)).toBe(42);
      expect(normalizeJsonBody(-42)).toBe(-42);
      expect(normalizeJsonBody(3.14159)).toBe(3.14159);
    });
  });

  describe("normalizeJsonBody - ISO-8601 Date String Normalization", () => {
    it("normalizes date-time strings with different timezone offsets to UTC ISO strings", () => {
      const utc = "2026-08-26T12:00:00.000Z";
      const offsetPlus2 = "2026-08-26T14:00:00.000+02:00";
      const offsetMinus4 = "2026-08-26T08:00:00.000-04:00";

      expect(normalizeJsonBody(utc)).toBe("2026-08-26T12:00:00.000Z");
      expect(normalizeJsonBody(offsetPlus2)).toBe("2026-08-26T12:00:00.000Z");
      expect(normalizeJsonBody(offsetMinus4)).toBe("2026-08-26T12:00:00.000Z");
    });

    it("preserves regular non-date strings untouched", () => {
      expect(normalizeJsonBody("simple string")).toBe("simple string");
      expect(normalizeJsonBody("2026-99-99T99:99:99Z")).toBe("2026-99-99T99:99:99Z");
    });
  });

  describe("normalizeJsonBody - Null & Undefined vs Missing Keys", () => {
    it("preserves explicit null values", () => {
      const input = {
        name: "test",
        optionalNull: null,
      };

      const result = normalizeJsonBody(input) as Record<string, unknown>;
      expect(result).toHaveProperty("optionalNull");
      expect(result.optionalNull).toBeNull();
    });

    it("drops undefined properties without synthesizing missing keys", () => {
      const input = {
        name: "test",
        omittedProp: undefined,
      };

      const result = normalizeJsonBody(input) as Record<string, unknown>;
      expect(result).toHaveProperty("name", "test");
      expect(result).not.toHaveProperty("omittedProp");
    });

    it("respects schema properties and preserves explicit null vs missing keys", () => {
      const schema: IRObjectSchema = {
        type: "object",
        properties: {
          id: { type: "integer" },
          tag: { type: "string", nullable: true },
          description: { type: "string", nullable: true },
        },
        required: ["id"],
      };

      // Payload contains explicit null for 'tag', and omits 'description'
      const payload = {
        id: 123,
        tag: null,
      };

      const result = normalizeJsonBody(payload, schema) as Record<string, unknown>;
      expect(result).toEqual({
        id: 123,
        tag: null,
      });
      // 'description' was missing from payload and must remain missing (not synthesized as null)
      expect(result).not.toHaveProperty("description");
    });
  });

  describe("normalizeBody - Integration with CapturedRequest & IROperation", () => {
    it("normalizes jsonBody from CapturedRequest", () => {
      const raw: CapturedRequest = {
        id: "req-1",
        timestamp: Date.now(),
        method: "POST",
        path: "/pets",
        query: {},
        headers: { "content-type": "application/json" },
        body: null,
        jsonBody: { name: "Fluffy", category: { id: 1, name: "Dogs" } },
      };

      const result = normalizeBody(raw);
      expect(result.body).toEqual({
        category: { id: 1, name: "Dogs" },
        name: "Fluffy",
      });
    });

    it("parses and normalizes JSON string from body when jsonBody is absent", () => {
      const raw: CapturedRequest = {
        id: "req-2",
        timestamp: Date.now(),
        method: "POST",
        path: "/pets",
        query: {},
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ z: 1, a: -0 }),
        jsonBody: null,
      };

      const result = normalizeBody(raw);
      expect(result.body).toEqual({
        a: 0,
        z: 1,
      });
    });

    it("preserves non-JSON raw body on parse failure", () => {
      const raw: CapturedRequest = {
        id: "req-3",
        timestamp: Date.now(),
        method: "POST",
        path: "/upload",
        query: {},
        headers: { "content-type": "text/plain" },
        body: "raw text content",
        jsonBody: null,
      };

      const result = normalizeBody(raw);
      expect(result.body).toBe("raw text content");
      expect(result.rawBody).toBe("raw text content");
    });

    it("uses schema from IROperation when provided", () => {
      const operation: IROperation = {
        id: "createPet",
        method: "POST",
        path: "/pets",
        parameters: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  photoUrls: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
      };

      const raw: CapturedRequest = {
        id: "req-4",
        timestamp: Date.now(),
        method: "POST",
        path: "/pets",
        query: {},
        headers: { "content-type": "application/json" },
        body: null,
        jsonBody: {
          photoUrls: ["https://example.com/1.png"],
          name: "Rex",
        },
      };

      const result = normalizeBody(raw, operation);
      expect(result.body).toEqual({
        name: "Rex",
        photoUrls: ["https://example.com/1.png"],
      });
    });
  });
});
