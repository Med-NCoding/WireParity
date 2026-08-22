import { describe, expect, it } from "vitest";
import { SchemaValueGenerator, SeededPRNG } from "../src/generator/index.js";
import type { IRSchema } from "../src/ir/values.js";

describe("Property-Based Generator & PRNG", () => {
  it("produces identical random sequence given identical seeds", () => {
    const prng1 = new SeededPRNG("test-seed-123");
    const prng2 = new SeededPRNG("test-seed-123");

    const seq1 = [prng1.next(), prng1.nextInt(0, 100), prng1.nextBoolean()];
    const seq2 = [prng2.next(), prng2.nextInt(0, 100), prng2.nextBoolean()];

    expect(seq1).toEqual(seq2);
  });

  it("generates schema-valid IR values respecting constraints and boundaries", () => {
    const prng = new SeededPRNG(42);
    const gen = new SchemaValueGenerator(prng);

    const schema: IRSchema = {
      type: "object",
      required: ["id", "status"],
      properties: {
        id: { type: "integer", minimum: 10, maximum: 20 },
        status: { type: "string", enum: ["active", "pending", "closed"] },
        createdAt: { type: "string", format: "date-time" },
        tags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
      },
    };

    const val = gen.generate(schema);
    expect(val.kind).toBe("object");

    if (val.kind === "object") {
      expect(val.fields.id).toBeDefined();
      expect(val.fields.id.kind).toBe("integer");
      if (val.fields.id.kind === "integer") {
        expect(val.fields.id.value).toBeGreaterThanOrEqual(10);
        expect(val.fields.id.value).toBeLessThanOrEqual(20);
      }

      expect(val.fields.status).toBeDefined();
      expect(val.fields.status.kind).toBe("enum");
    }
  });
});
