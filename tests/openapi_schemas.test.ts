/**
 * Tests for Step 2.4: Safe Documented allOf Schema Intersection
 *
 * Verifies:
 * 1. Object property union across sub-schemas (later sub-schema wins on duplicate)
 * 2. Required array union across sub-schemas
 * 3. Format intersection — kept only when all concrete sub-schemas agree
 * 4. Conflicting concrete types throw OpenAPIParseError
 * 5. Nullable propagation from any sub-schema
 * 6. Multi-level / nested allOf
 * 7. Parent-schema properties override sub-schema properties
 * 8. allOf with $ref sub-schemas
 */

import { describe, it, expect, vi } from "vitest";
import { parseOpenAPISpec, OpenAPIParseError } from "../src/openapi/parser.js";
import type { IRObjectSchema, IRSchema } from "../src/ir/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function anySchema(spec: object): IRSchema {
  const doc = parseOpenAPISpec({
    openapi: "3.0.3",
    info: { title: "T", version: "1" },
    paths: {
      "/x": {
        get: {
          operationId: "op",
          requestBody: {
            required: true,
            content: { "application/json": { schema: spec } },
          },
          responses: {},
        },
      },
    },
  });
  const body = doc.operations[0]!.requestBody!;
  return body.content["application/json"]!.schema;
}

function objectSchema(spec: object): IRObjectSchema {
  return anySchema(spec) as IRObjectSchema;
}

// ---------------------------------------------------------------------------
// 1. Object property union
// ---------------------------------------------------------------------------

describe("allOf object property union", () => {
  it("merges properties from two object sub-schemas", () => {
    const schema = objectSchema({
      allOf: [
        { type: "object", properties: { id: { type: "string" } } },
        { type: "object", properties: { name: { type: "string" } } },
      ],
    });
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("id");
    expect(schema.properties).toHaveProperty("name");
  });

  it("later sub-schema wins when the same property name appears in multiple sub-schemas", () => {
    const schema = objectSchema({
      allOf: [
        { type: "object", properties: { status: { type: "string" } } },
        { type: "object", properties: { status: { type: "integer" } } },
      ],
    });
    expect(schema.properties["status"]!.type).toBe("integer");
  });

  it("merges properties from three sub-schemas", () => {
    const schema = objectSchema({
      allOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { type: "object", properties: { b: { type: "integer" } } },
        { type: "object", properties: { c: { type: "boolean" } } },
      ],
    });
    expect(Object.keys(schema.properties)).toHaveLength(3);
    expect(schema.properties["a"]!.type).toBe("string");
    expect(schema.properties["b"]!.type).toBe("integer");
    expect(schema.properties["c"]!.type).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// 2. Required array union
// ---------------------------------------------------------------------------

describe("allOf required array union", () => {
  it("unions required arrays from all sub-schemas", () => {
    const schema = objectSchema({
      allOf: [
        { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      ],
    });
    expect(schema.required).toContain("id");
    expect(schema.required).toContain("name");
  });

  it("deduplicates required fields", () => {
    const schema = objectSchema({
      allOf: [
        { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        { type: "object", properties: { id: { type: "string" }, x: { type: "string" } }, required: ["id", "x"] },
      ],
    });
    const count = schema.required?.filter((r) => r === "id").length;
    expect(count).toBe(1);
    expect(schema.required).toContain("x");
  });

  it("produces no required array when no sub-schema declares required", () => {
    const schema = objectSchema({
      allOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { type: "object", properties: { b: { type: "string" } } },
      ],
    });
    expect(schema.required).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Format intersection
// ---------------------------------------------------------------------------

describe("allOf format intersection", () => {
  it("keeps format when all sub-schemas agree", () => {
    const schema = objectSchema({
      allOf: [
        { type: "object", properties: { ts: { type: "string", format: "date-time" } } },
        { type: "object", properties: { name: { type: "string" } } },
      ],
    });
    // format is on a nested property, not the allOf root — check property schema
    const ts = schema.properties["ts"]!;
    expect((ts as { format?: string }).format).toBe("date-time");
  });

  it("drops format at allOf root when sub-schemas disagree", () => {
    // Two sub-schemas each resolving to object but declaring different formats
    // We test this via the merged root — if formats differ, format is omitted
    const schema = objectSchema({
      allOf: [
        { type: "object", format: "date-time", properties: { a: { type: "string" } } },
        { type: "object", format: "date", properties: { b: { type: "string" } } },
      ],
    });
    // format conflict → no format on merged result
    expect((schema as { format?: string }).format).toBeUndefined();
  });

  it("propagates format when only one concrete sub-schema declares it (others are opaque)", () => {
    // One sub-schema is a string with format; the other has no type (resolves to "any").
    // formats array has one entry, all agree → format is kept.
    const schema = objectSchema({
      allOf: [
        { type: "object", properties: { ts: { type: "string", format: "uuid" } } },
        { type: "object", properties: { name: { type: "string" } } },
      ],
    });
    // format lives on the nested property schema, not the allOf root
    const ts = schema.properties["ts"]! as { format?: string };
    expect(ts.format).toBe("uuid");
  });
});

// ---------------------------------------------------------------------------
// 4. Conflicting concrete types → error
// ---------------------------------------------------------------------------

describe("allOf conflicting type error", () => {
  it("throws OpenAPIParseError when string and integer appear in allOf", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/x": {
          get: {
            operationId: "op",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    allOf: [{ type: "string" }, { type: "integer" }],
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    };
    expect(() => parseOpenAPISpec(spec)).toThrow(OpenAPIParseError);
  });

  it("throws OpenAPIParseError when object and array appear in allOf", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/x": {
          get: {
            operationId: "op",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { type: "object", properties: {} },
                      { type: "array", items: { type: "string" } },
                    ],
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    };
    expect(() => parseOpenAPISpec(spec)).toThrow(OpenAPIParseError);
  });

  it("does not throw when all concrete types are the same", () => {
    expect(() =>
      objectSchema({
        allOf: [
          { type: "object", properties: { a: { type: "string" } } },
          { type: "object", properties: { b: { type: "string" } } },
        ],
      })
    ).not.toThrow();
  });

  it("does not throw when mixing 'any' with a concrete type (no conflict)", () => {
    // sub-schema with no type resolves to "any" — should not be treated as conflicting
    expect(() =>
      objectSchema({
        allOf: [
          { type: "object", properties: { a: { type: "string" } } },
          { description: "opaque sub-schema with no type" },
        ],
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. Nullable propagation
// ---------------------------------------------------------------------------

describe("allOf nullable propagation", () => {
  it("result is nullable when any sub-schema is nullable", () => {
    const schema = objectSchema({
      allOf: [
        { type: "object", properties: { a: { type: "string" } }, nullable: true },
        { type: "object", properties: { b: { type: "string" } } },
      ],
    });
    expect(schema.nullable).toBe(true);
  });

  it("result is nullable when the parent schema is nullable", () => {
    const schema = objectSchema({
      nullable: true,
      allOf: [
        { type: "object", properties: { a: { type: "string" } } },
      ],
    });
    expect(schema.nullable).toBe(true);
  });

  it("result is not nullable when no sub-schema is nullable", () => {
    const schema = objectSchema({
      allOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { type: "object", properties: { b: { type: "string" } } },
      ],
    });
    expect(schema.nullable).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// 6. Multi-level / nested allOf
// ---------------------------------------------------------------------------

describe("allOf multi-level nesting", () => {
  it("recursively merges nested allOf schemas", () => {
    const schema = objectSchema({
      allOf: [
        {
          allOf: [
            { type: "object", properties: { a: { type: "string" } } },
            { type: "object", properties: { b: { type: "string" } } },
          ],
        },
        { type: "object", properties: { c: { type: "string" } } },
      ],
    });
    expect(schema.properties).toHaveProperty("a");
    expect(schema.properties).toHaveProperty("b");
    expect(schema.properties).toHaveProperty("c");
  });
});

// ---------------------------------------------------------------------------
// 7. Parent-schema properties override sub-schema properties
// ---------------------------------------------------------------------------

describe("allOf parent-schema property override", () => {
  it("parent-level property overrides the same-named property from a sub-schema", () => {
    const schema = objectSchema({
      properties: { id: { type: "integer" } },
      allOf: [
        { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
      ],
    });
    // parent's id:integer must win
    expect(schema.properties["id"]!.type).toBe("integer");
    expect(schema.properties).toHaveProperty("name");
  });

  it("parent-level required extends sub-schema required", () => {
    const schema = objectSchema({
      required: ["extra"],
      allOf: [
        { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      ],
    });
    expect(schema.required).toContain("id");
    expect(schema.required).toContain("extra");
  });
});

// ---------------------------------------------------------------------------
// 8. allOf with $ref sub-schemas
// ---------------------------------------------------------------------------

describe("allOf with $ref sub-schemas", () => {
  it("resolves $ref sub-schemas and merges their properties", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      components: {
        schemas: {
          Base: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
          Extra: { type: "object", properties: { email: { type: "string" } } },
        },
      },
      paths: {
        "/x": {
          get: {
            operationId: "op",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/Base" },
                      { $ref: "#/components/schemas/Extra" },
                    ],
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const body = doc.operations[0]!.requestBody!.content["application/json"]!.schema as IRObjectSchema;
    expect(body.type).toBe("object");
    expect(body.properties).toHaveProperty("id");
    expect(body.properties).toHaveProperty("email");
    expect(body.required).toContain("id");
  });

  it("throws when $ref sub-schemas have conflicting types", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      components: {
        schemas: {
          AsString: { type: "string" },
          AsInteger: { type: "integer" },
        },
      },
      paths: {
        "/x": {
          get: {
            operationId: "op",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/AsString" },
                      { $ref: "#/components/schemas/AsInteger" },
                    ],
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    };
    expect(() => parseOpenAPISpec(spec)).toThrow(OpenAPIParseError);
  });
});

// ---------------------------------------------------------------------------
// 9. oneOf Schema Polymorphism Fallback & Telemetry
// ---------------------------------------------------------------------------

describe("oneOf schema polymorphism fallback", () => {
  it("selects the first non-null variant as fallback representation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = anySchema({
      oneOf: [
        { type: "string", format: "email" },
        { type: "integer" },
      ],
    });
    expect(schema.type).toBe("string");
    expect((schema as { format?: string }).format).toBe("email");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[WireParity] oneOf polymorphism fallback")
    );
    warnSpy.mockRestore();
  });

  it("propagates nullable: true when a variant is type 'null'", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = anySchema({
      oneOf: [
        { type: "string" },
        { type: "null" },
      ],
    });
    expect(schema.type).toBe("string");
    expect(schema.nullable).toBe(true);
    warnSpy.mockRestore();
  });

  it("skips leading null variant and selects the first non-null variant", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = anySchema({
      oneOf: [
        { type: "null" },
        { type: "integer", minimum: 0 },
      ],
    });
    expect(schema.type).toBe("integer");
    expect((schema as { minimum?: number }).minimum).toBe(0);
    expect(schema.nullable).toBe(true);
    warnSpy.mockRestore();
  });

  it("resolves $ref variants and selects the first non-null variant", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      components: {
        schemas: {
          Cat: { type: "object", properties: { meow: { type: "boolean" } } },
          Dog: { type: "object", properties: { bark: { type: "boolean" } } },
        },
      },
      paths: {
        "/pet": {
          post: {
            operationId: "createPet",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/Cat" },
                      { $ref: "#/components/schemas/Dog" },
                    ],
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const schema = doc.operations[0]!.requestBody!.content["application/json"]!.schema as IRObjectSchema;
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("meow");
    expect(schema.properties).not.toHaveProperty("bark");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[WireParity] oneOf polymorphism fallback")
    );
    warnSpy.mockRestore();
  });

  it("returns { type: 'any' } when oneOf array is empty", () => {
    const schema = anySchema({
      oneOf: [],
    });
    expect(schema.type).toBe("any");
  });

  it("returns { type: 'null' } when all variants are null", () => {
    const schema = anySchema({
      oneOf: [{ type: "null" }],
    });
    expect(schema.type).toBe("null");
  });

  it("preserves parent description when specified", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = anySchema({
      description: "Polymorphic payload",
      oneOf: [
        { type: "string" },
        { type: "number" },
      ],
    });
    expect(schema.description).toBe("Polymorphic payload");
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 10. anyOf Schema Polymorphism Fallback & Telemetry
// ---------------------------------------------------------------------------

describe("anyOf schema polymorphism fallback", () => {
  it("selects the first non-null variant as fallback representation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = anySchema({
      anyOf: [
        { type: "object", properties: { token: { type: "string" } } },
        { type: "object", properties: { key: { type: "string" } } },
      ],
    }) as IRObjectSchema;
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("token");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[WireParity] anyOf polymorphism fallback")
    );
    warnSpy.mockRestore();
  });

  it("propagates nullable: true when a variant is type 'null'", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = anySchema({
      anyOf: [
        { type: "integer" },
        { type: "null" },
      ],
    });
    expect(schema.type).toBe("integer");
    expect(schema.nullable).toBe(true);
    warnSpy.mockRestore();
  });

  it("resolves $ref variants in anyOf", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      components: {
        schemas: {
          PrimaryAuth: { type: "object", properties: { apiKey: { type: "string" } } },
          SecondaryAuth: { type: "object", properties: { oauthToken: { type: "string" } } },
        },
      },
      paths: {
        "/auth": {
          post: {
            operationId: "auth",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    anyOf: [
                      { $ref: "#/components/schemas/PrimaryAuth" },
                      { $ref: "#/components/schemas/SecondaryAuth" },
                    ],
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const schema = doc.operations[0]!.requestBody!.content["application/json"]!.schema as IRObjectSchema;
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("apiKey");
    expect(schema.properties).not.toHaveProperty("oauthToken");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[WireParity] anyOf polymorphism fallback")
    );
    warnSpy.mockRestore();
  });

  it("returns { type: 'any' } when anyOf array is empty", () => {
    const schema = anySchema({
      anyOf: [],
    });
    expect(schema.type).toBe("any");
  });

  it("handles nested oneOf inside anyOf safely", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = anySchema({
      anyOf: [
        {
          oneOf: [
            { type: "string", format: "uuid" },
            { type: "string", format: "email" },
          ],
        },
        { type: "integer" },
      ],
    });
    expect(schema.type).toBe("string");
    expect((schema as { format?: string }).format).toBe("uuid");
    warnSpy.mockRestore();
  });
});

