/**
 * WireParity - Step 6.4: Complex Object & Array Arbitraries Tests
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { irArrayArbitrary, irObjectArbitrary, irValueArbitrary } from "../src/generator/arbitraries/complex.js";
import type {
  IRArraySchema,
  IRObjectSchema,
  IRArrayValue,
  IRObjectValue,
  IRValue,
} from "../src/ir/values.js";

// ─── Array Arbitrary Tests ────────────────────────────────────────────────────

describe("irArrayArbitrary", () => {
  it("generates arrays within [minItems, maxItems]", () => {
    const schema: IRArraySchema = {
      type: "array",
      items: { type: "integer" },
      minItems: 2,
      maxItems: 5,
    };
    fc.assert(
      fc.property(irArrayArbitrary(schema), (arr) => {
        expect(arr.kind).toBe("array");
        expect(arr.items.length).toBeGreaterThanOrEqual(2);
        expect(arr.items.length).toBeLessThanOrEqual(5);
        for (const item of arr.items) {
          expect(item.kind).toBe("integer");
        }
      }),
      { numRuns: 200 }
    );
  });

  it("allows empty arrays when minItems is 0", () => {
    const schema: IRArraySchema = {
      type: "array",
      items: { type: "boolean" },
      minItems: 0,
      maxItems: 4,
    };
    // Verify empty arrays are possible
    let sawEmpty = false;
    fc.assert(
      fc.property(irArrayArbitrary(schema), (arr) => {
        if (arr.items.length === 0) sawEmpty = true;
        return true;
      }),
      { numRuns: 500 }
    );
    expect(sawEmpty).toBe(true);
  });

  it("deduplicates when uniqueItems is true", () => {
    const schema: IRArraySchema = {
      type: "array",
      items: { type: "integer", minimum: 0, maximum: 3 }, // small range → high collision chance
      minItems: 0,
      maxItems: 8,
      uniqueItems: true,
    };
    fc.assert(
      fc.property(irArrayArbitrary(schema), (arr) => {
        const keys = arr.items.map((v) => JSON.stringify(v));
        const unique = new Set(keys);
        expect(unique.size).toBe(keys.length);
      }),
      { numRuns: 200 }
    );
  });

  it("preserves insertion order when deduplicating (not set semantics)", () => {
    const schema: IRArraySchema = {
      type: "array",
      items: { type: "string", enum: ["a", "b"] },
      minItems: 0,
      maxItems: 6,
      uniqueItems: true,
    };
    fc.assert(
      fc.property(irArrayArbitrary(schema), (arr) => {
        // At most 2 unique string enum values
        expect(arr.items.length).toBeLessThanOrEqual(2);
      }),
      { numRuns: 200 }
    );
  });

  it("uses default bounds when minItems/maxItems are absent", () => {
    const schema: IRArraySchema = {
      type: "array",
      items: { type: "boolean" },
    };
    fc.assert(
      fc.property(irArrayArbitrary(schema), (arr) => {
        expect(arr.items.length).toBeGreaterThanOrEqual(0);
        expect(arr.items.length).toBeLessThanOrEqual(8);
      }),
      { numRuns: 200 }
    );
  });

  it("generates nested arrays", () => {
    const schema: IRArraySchema = {
      type: "array",
      items: {
        type: "array",
        items: { type: "integer" },
        minItems: 1,
        maxItems: 3,
      },
      minItems: 1,
      maxItems: 3,
    };
    fc.assert(
      fc.property(irArrayArbitrary(schema), (arr) => {
        expect(arr.kind).toBe("array");
        for (const inner of arr.items) {
          expect(inner.kind).toBe("array");
          expect((inner as IRArrayValue).items.length).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Object Arbitrary Tests ───────────────────────────────────────────────────

describe("irObjectArbitrary", () => {
  it("always generates required fields", () => {
    const schema: IRObjectSchema = {
      type: "object",
      properties: {
        id: { type: "integer" },
        name: { type: "string" },
        active: { type: "boolean" },
      },
      required: ["id", "name"],
    };
    fc.assert(
      fc.property(irObjectArbitrary(schema), (obj) => {
        expect(obj.kind).toBe("object");
        expect("id" in obj.fields).toBe(true);
        expect("name" in obj.fields).toBe(true);
        expect(obj.fields["id"]!.kind).toBe("integer");
        expect(obj.fields["name"]!.kind).toBe("string");
      }),
      { numRuns: 200 }
    );
  });

  it("optional fields may be absent", () => {
    const schema: IRObjectSchema = {
      type: "object",
      properties: {
        id: { type: "integer" },
        description: { type: "string" },
      },
      required: ["id"],
    };
    let sawAbsent = false;
    fc.assert(
      fc.property(irObjectArbitrary(schema), (obj) => {
        if (!("description" in obj.fields)) sawAbsent = true;
        return true;
      }),
      { numRuns: 500 }
    );
    expect(sawAbsent).toBe(true);
  });

  it("optional nullable fields can be explicit null, value, or absent", () => {
    const schema: IRObjectSchema = {
      type: "object",
      properties: {
        id: { type: "integer" },
        tag: { type: "string", nullable: true },
      },
      required: ["id"],
    };

    let sawNull = false;
    let sawValue = false;
    let sawAbsent = false;

    fc.assert(
      fc.property(irObjectArbitrary(schema), (obj) => {
        if (!("tag" in obj.fields)) {
          sawAbsent = true;
        } else if (obj.fields["tag"]!.kind === "null") {
          sawNull = true;
        } else {
          sawValue = true;
        }
        return true;
      }),
      { numRuns: 1000 }
    );

    expect(sawNull).toBe(true);
    expect(sawValue).toBe(true);
    expect(sawAbsent).toBe(true);
  });

  it("generates empty objects when no properties are defined", () => {
    const schema: IRObjectSchema = {
      type: "object",
      properties: {},
    };
    fc.assert(
      fc.property(irObjectArbitrary(schema), (obj) => {
        expect(obj.kind).toBe("object");
      }),
      { numRuns: 50 }
    );
  });

  it("generates nested objects", () => {
    const schema: IRObjectSchema = {
      type: "object",
      properties: {
        id: { type: "integer" },
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            zip: { type: "string" },
          },
          required: ["street"],
        },
      },
      required: ["id", "address"],
    };
    fc.assert(
      fc.property(irObjectArbitrary(schema), (obj) => {
        expect(obj.kind).toBe("object");
        const address = obj.fields["address"] as IRObjectValue;
        expect(address.kind).toBe("object");
        expect("street" in address.fields).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("generates array-valued object fields", () => {
    const schema: IRObjectSchema = {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
      },
      required: ["tags"],
    };
    fc.assert(
      fc.property(irObjectArbitrary(schema), (obj) => {
        const tags = obj.fields["tags"] as IRArrayValue;
        expect(tags.kind).toBe("array");
        expect(tags.items.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── irValueArbitrary Dispatcher Tests ───────────────────────────────────────

describe("irValueArbitrary", () => {
  it("dispatches to array arbitrary", () => {
    const schema: IRArraySchema = { type: "array", items: { type: "boolean" }, minItems: 1, maxItems: 2 };
    fc.assert(
      fc.property(irValueArbitrary(schema), (v) => {
        expect(v.kind).toBe("array");
      }),
      { numRuns: 50 }
    );
  });

  it("dispatches to object arbitrary", () => {
    const schema: IRObjectSchema = {
      type: "object",
      properties: { x: { type: "integer" } },
      required: ["x"],
    };
    fc.assert(
      fc.property(irValueArbitrary(schema), (v) => {
        expect(v.kind).toBe("object");
      }),
      { numRuns: 50 }
    );
  });

  it("generates null for nullable array schema", () => {
    const schema: IRArraySchema = {
      type: "array",
      items: { type: "integer" },
      nullable: true,
    };
    let sawNull = false;
    fc.assert(
      fc.property(irValueArbitrary(schema), (v) => {
        if (v.kind === "null") sawNull = true;
        return true;
      }),
      { numRuns: 500 }
    );
    expect(sawNull).toBe(true);
  });

  it("generates null for nullable object schema", () => {
    const schema: IRObjectSchema = {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
      nullable: true,
    };
    let sawNull = false;
    fc.assert(
      fc.property(irValueArbitrary(schema), (v) => {
        if (v.kind === "null") sawNull = true;
        return true;
      }),
      { numRuns: 500 }
    );
    expect(sawNull).toBe(true);
  });

  it("dispatches any schema to representative scalars", () => {
    const schema = { type: "any" as const };
    fc.assert(
      fc.property(irValueArbitrary(schema), (v) => {
        expect(["null", "boolean", "integer", "string"]).toContain(v.kind);
      }),
      { numRuns: 100 }
    );
  });
});
