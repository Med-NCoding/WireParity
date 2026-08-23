import { describe, expect, it } from "vitest";
import { OpenAPIRefResolver, ResolverError } from "../src/openapi/resolver.js";
import type { OpenAPISpecRaw } from "../src/openapi/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(components: OpenAPISpecRaw["components"] = {}): OpenAPISpecRaw {
  return {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    components,
  };
}

// ---------------------------------------------------------------------------
// Direct (non-ref) resolution
// ---------------------------------------------------------------------------
describe("OpenAPIRefResolver – direct object passthrough", () => {
  it("returns a non-ref object unchanged", () => {
    const resolver = new OpenAPIRefResolver(makeDoc());
    const obj = { type: "string" };
    expect(resolver.resolve(obj)).toBe(obj);
  });

  it("returns a primitive unchanged", () => {
    const resolver = new OpenAPIRefResolver(makeDoc());
    expect(resolver.resolve("plain" as unknown as { $ref: string })).toBe("plain");
  });
});

// ---------------------------------------------------------------------------
// Single-hop $ref resolution
// ---------------------------------------------------------------------------
describe("OpenAPIRefResolver – single-hop $ref resolution", () => {
  it("resolves a schema $ref from #/components/schemas", () => {
    const doc = makeDoc({
      schemas: {
        User: { type: "object", properties: { id: { type: "integer" } } },
      },
    });
    const resolver = new OpenAPIRefResolver(doc);
    const result = resolver.resolve({ $ref: "#/components/schemas/User" });
    expect(result).toEqual({ type: "object", properties: { id: { type: "integer" } } });
  });

  it("resolves a parameter $ref from #/components/parameters", () => {
    const doc = makeDoc({
      parameters: {
        UserId: { name: "userId", in: "path", required: true, schema: { type: "string" } },
      },
    });
    const resolver = new OpenAPIRefResolver(doc);
    const result = resolver.resolve({ $ref: "#/components/parameters/UserId" });
    expect((result as { name: string }).name).toBe("userId");
  });

  it("resolves a requestBody $ref from #/components/requestBodies", () => {
    const doc = makeDoc({
      requestBodies: {
        CreateUser: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
      },
    });
    const resolver = new OpenAPIRefResolver(doc);
    const result = resolver.resolve({ $ref: "#/components/requestBodies/CreateUser" }) as {
      required: boolean;
    };
    expect(result.required).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deep / chained $ref resolution
// ---------------------------------------------------------------------------
describe("OpenAPIRefResolver – deep and chained $ref resolution", () => {
  it("resolves a deeply nested path with multiple segments", () => {
    const doc = makeDoc({
      schemas: {
        Nested: {
          type: "object",
          properties: {
            address: { type: "object", properties: { zip: { type: "string" } } },
          },
        },
      },
    });
    const resolver = new OpenAPIRefResolver(doc);
    const result = resolver.resolve({
      $ref: "#/components/schemas/Nested",
    }) as { type: string };
    expect(result.type).toBe("object");
  });

  it("follows a chain: ref A → ref B → concrete", () => {
    // Components schemas: AliasUser → User → concrete object
    const doc: OpenAPISpecRaw = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      components: {
        schemas: {
          User: { type: "object", properties: { id: { type: "integer" } } },
          // AliasUser points to User via another $ref – simulating chain
        } as unknown as OpenAPISpecRaw["components"]["schemas"],
      },
    };

    // Inject a ref-to-ref into the doc structure manually
    (doc.components!.schemas as Record<string, unknown>)["AliasUser"] = {
      $ref: "#/components/schemas/User",
    };

    const resolver = new OpenAPIRefResolver(doc);
    // Resolve the alias – it should hop AliasUser → User → object
    const result = resolver.resolve({
      $ref: "#/components/schemas/AliasUser",
    }) as { type: string; $ref?: string };

    // The final resolved value should be the concrete User schema, not another $ref
    expect(result.type).toBe("object");
    expect(result.$ref).toBeUndefined();
  });

  it("resolves a path with JSON Pointer ~1 escape (slash in segment)", () => {
    const doc: OpenAPISpecRaw = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      components: {
        schemas: {} as unknown as OpenAPISpecRaw["components"]["schemas"],
      },
    };
    // Key contains a "/" — encoded as "~1" in JSON Pointer
    (doc.components!.schemas as Record<string, unknown>)["application/json"] = {
      type: "string",
      format: "binary",
    };

    const resolver = new OpenAPIRefResolver(doc);
    const result = resolver.resolve({
      $ref: "#/components/schemas/application~1json",
    }) as { type: string };
    expect(result.type).toBe("string");
  });

  it("resolves a path with JSON Pointer ~0 escape (tilde in segment)", () => {
    const doc: OpenAPISpecRaw = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      components: {
        schemas: {} as unknown as OpenAPISpecRaw["components"]["schemas"],
      },
    };
    // Key contains a "~" — encoded as "~0" in JSON Pointer
    (doc.components!.schemas as Record<string, unknown>)["foo~bar"] = {
      type: "boolean",
    };

    const resolver = new OpenAPIRefResolver(doc);
    const result = resolver.resolve({
      $ref: "#/components/schemas/foo~0bar",
    }) as { type: string };
    expect(result.type).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// resolveAll
// ---------------------------------------------------------------------------
describe("OpenAPIRefResolver – resolveAll", () => {
  it("resolves a mixed array of concrete objects and refs", () => {
    const doc = makeDoc({
      schemas: {
        Tag: { type: "string" },
        Count: { type: "integer" },
      },
    });
    const resolver = new OpenAPIRefResolver(doc);
    const results = resolver.resolveAll([
      { type: "boolean" },
      { $ref: "#/components/schemas/Tag" },
      { $ref: "#/components/schemas/Count" },
    ]);
    expect(results).toHaveLength(3);
    expect((results[0] as { type: string }).type).toBe("boolean");
    expect((results[1] as { type: string }).type).toBe("string");
    expect((results[2] as { type: string }).type).toBe("integer");
  });

  it("returns an empty array for empty input", () => {
    const resolver = new OpenAPIRefResolver(makeDoc());
    expect(resolver.resolveAll([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Circular reference detection
// ---------------------------------------------------------------------------
describe("OpenAPIRefResolver – circular reference detection", () => {
  it("throws ResolverError when a ref directly points to itself", () => {
    const doc: OpenAPISpecRaw = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      components: { schemas: {} as unknown as OpenAPISpecRaw["components"]["schemas"] },
    };
    (doc.components!.schemas as Record<string, unknown>)["Self"] = {
      $ref: "#/components/schemas/Self",
    };

    const resolver = new OpenAPIRefResolver(doc);
    expect(() => resolver.resolve({ $ref: "#/components/schemas/Self" })).toThrow(
      ResolverError
    );
  });

  it("throws ResolverError for an indirect cycle A → B → A", () => {
    const doc: OpenAPISpecRaw = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      components: { schemas: {} as unknown as OpenAPISpecRaw["components"]["schemas"] },
    };
    const schemas = doc.components!.schemas as Record<string, unknown>;
    schemas["SchemaA"] = { $ref: "#/components/schemas/SchemaB" };
    schemas["SchemaB"] = { $ref: "#/components/schemas/SchemaA" };

    const resolver = new OpenAPIRefResolver(doc);
    expect(() => resolver.resolve({ $ref: "#/components/schemas/SchemaA" })).toThrow(
      ResolverError
    );
  });

  it("error message includes the circular ref path", () => {
    const doc: OpenAPISpecRaw = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      components: { schemas: {} as unknown as OpenAPISpecRaw["components"]["schemas"] },
    };
    (doc.components!.schemas as Record<string, unknown>)["Loop"] = {
      $ref: "#/components/schemas/Loop",
    };

    const resolver = new OpenAPIRefResolver(doc);
    let caughtError: ResolverError | null = null;
    try {
      resolver.resolve({ $ref: "#/components/schemas/Loop" });
    } catch (e) {
      caughtError = e as ResolverError;
    }
    expect(caughtError).toBeInstanceOf(ResolverError);
    expect(caughtError!.message).toContain("#/components/schemas/Loop");
    expect(caughtError!.ref).toBe("#/components/schemas/Loop");
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------
describe("OpenAPIRefResolver – error cases", () => {
  it("throws ResolverError for an external $ref (http://...)", () => {
    const resolver = new OpenAPIRefResolver(makeDoc());
    expect(() =>
      resolver.resolve({ $ref: "http://example.com/schemas/User" })
    ).toThrow(ResolverError);
  });

  it("throws ResolverError for a relative file $ref (./schema.yaml)", () => {
    const resolver = new OpenAPIRefResolver(makeDoc());
    expect(() => resolver.resolve({ $ref: "./schema.yaml#/User" })).toThrow(ResolverError);
  });

  it("throws ResolverError when a segment does not exist", () => {
    const resolver = new OpenAPIRefResolver(makeDoc({ schemas: {} as unknown as OpenAPISpecRaw["components"]["schemas"] }));
    expect(() =>
      resolver.resolve({ $ref: "#/components/schemas/NonExistent" })
    ).toThrow(ResolverError);
  });

  it("throws ResolverError when path traverses through a primitive", () => {
    const doc: OpenAPISpecRaw = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      components: { schemas: {} as unknown as OpenAPISpecRaw["components"]["schemas"] },
    };
    (doc.components!.schemas as Record<string, unknown>)["Prim"] = "just-a-string";

    const resolver = new OpenAPIRefResolver(doc);
    expect(() =>
      resolver.resolve({ $ref: "#/components/schemas/Prim/nested" })
    ).toThrow(ResolverError);
  });

  it("ResolverError carries the ref string on .ref", () => {
    const resolver = new OpenAPIRefResolver(makeDoc());
    let caught: ResolverError | null = null;
    try {
      resolver.resolve({ $ref: "#/components/schemas/Missing" });
    } catch (e) {
      caught = e as ResolverError;
    }
    expect(caught).toBeInstanceOf(ResolverError);
    expect(caught!.ref).toBe("#/components/schemas/Missing");
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.name).toBe("ResolverError");
  });
});
