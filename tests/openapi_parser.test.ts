import { describe, expect, it } from "vitest";
import { OpenAPIParseError, parseOpenAPISpec, parseSpecContent, validateOpenAPIRoot } from "../src/openapi/parser.js";
import type { IRSchema } from "../src/index.js";

// ---------------------------------------------------------------------------
// Root validation
// ---------------------------------------------------------------------------
describe("validateOpenAPIRoot – strict root validation", () => {
  it("rejects null / non-object inputs", () => {
    expect(() => validateOpenAPIRoot(null)).toThrow(OpenAPIParseError);
    expect(() => validateOpenAPIRoot(undefined)).toThrow(OpenAPIParseError);
    expect(() => validateOpenAPIRoot("openapi")).toThrow(OpenAPIParseError);
    expect(() => validateOpenAPIRoot([])).toThrow(OpenAPIParseError);
  });

  it("rejects specs missing the 'openapi' field", () => {
    expect(() =>
      validateOpenAPIRoot({ info: { title: "T", version: "1.0.0" } })
    ).toThrow(OpenAPIParseError);
  });

  it("rejects specs with a non-string 'openapi' field", () => {
    expect(() =>
      validateOpenAPIRoot({ openapi: 3, info: { title: "T", version: "1.0.0" } })
    ).toThrow(OpenAPIParseError);
  });

  it("rejects unsupported openapi versions (2.0, 4.0)", () => {
    expect(() =>
      validateOpenAPIRoot({ openapi: "2.0", info: { title: "T", version: "1" } })
    ).toThrow(OpenAPIParseError);
    expect(() =>
      validateOpenAPIRoot({ openapi: "4.0.0", info: { title: "T", version: "1" } })
    ).toThrow(OpenAPIParseError);
  });

  it("accepts valid OpenAPI 3.0.x versions", () => {
    const spec = { openapi: "3.0.3", info: { title: "API", version: "1.0.0" } };
    expect(() => validateOpenAPIRoot(spec)).not.toThrow();
  });

  it("accepts valid OpenAPI 3.1.x versions", () => {
    const spec = { openapi: "3.1.0", info: { title: "API", version: "2.0.0" } };
    expect(() => validateOpenAPIRoot(spec)).not.toThrow();
  });

  it("rejects specs missing the 'info' block", () => {
    expect(() =>
      validateOpenAPIRoot({ openapi: "3.0.3" })
    ).toThrow(OpenAPIParseError);
  });

  it("rejects specs with empty info.title", () => {
    expect(() =>
      validateOpenAPIRoot({ openapi: "3.0.3", info: { title: "", version: "1.0.0" } })
    ).toThrow(OpenAPIParseError);
  });

  it("rejects specs with empty info.version", () => {
    expect(() =>
      validateOpenAPIRoot({ openapi: "3.0.3", info: { title: "T", version: "" } })
    ).toThrow(OpenAPIParseError);
  });

  it("attaches a meaningful field name to validation errors", () => {
    try {
      validateOpenAPIRoot({ openapi: "3.0.3", info: { title: "T", version: "" } });
    } catch (e) {
      expect(e).toBeInstanceOf(OpenAPIParseError);
      expect((e as OpenAPIParseError).field).toBe("info.version");
    }
  });
});

// ---------------------------------------------------------------------------
// OpenAPI 3.0 parsing
// ---------------------------------------------------------------------------
describe("parseOpenAPISpec – OpenAPI 3.0 spec parsing", () => {
  const minimalSpec30 = {
    openapi: "3.0.3",
    info: { title: "Pet Store", version: "1.0.0" },
    paths: {},
  };

  it("parses a minimal 3.0 spec without paths", () => {
    const ir = parseOpenAPISpec(minimalSpec30);
    expect(ir.title).toBe("Pet Store");
    expect(ir.version).toBe("1.0.0");
    expect(ir.operations).toHaveLength(0);
  });

  it("defaults servers to ['/'] when none provided", () => {
    const ir = parseOpenAPISpec(minimalSpec30);
    expect(ir.servers).toEqual(["/"]);
  });

  it("parses explicit servers array", () => {
    const spec = {
      ...minimalSpec30,
      servers: [{ url: "https://api.example.com" }, { url: "https://staging.example.com" }],
    };
    const ir = parseOpenAPISpec(spec);
    expect(ir.servers).toEqual(["https://api.example.com", "https://staging.example.com"]);
  });

  it("parses GET operation with path and query parameters", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "User API", version: "1.0.0" },
      paths: {
        "/users/{userId}": {
          get: {
            operationId: "getUser",
            parameters: [
              { name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
              { name: "expand", in: "query", schema: { type: "boolean" } },
            ],
          },
        },
      },
    };
    const ir = parseOpenAPISpec(spec);
    expect(ir.operations).toHaveLength(1);
    const op = ir.operations[0];
    expect(op.id).toBe("getUser");
    expect(op.method).toBe("GET");
    expect(op.path).toBe("/users/{userId}");
    expect(op.parameters).toHaveLength(2);

    const pathParam = op.parameters.find((p) => p.name === "userId")!;
    expect(pathParam.in).toBe("path");
    expect(pathParam.required).toBe(true);
    expect(pathParam.schema.type).toBe("string");

    const queryParam = op.parameters.find((p) => p.name === "expand")!;
    expect(queryParam.in).toBe("query");
    expect(queryParam.required).toBe(false);
  });

  it("generates operationId from method+path when not provided", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "API", version: "1.0.0" },
      paths: {
        "/items/{id}": {
          delete: { parameters: [] },
        },
      },
    };
    const ir = parseOpenAPISpec(spec);
    expect(ir.operations[0].id).toBe("delete_items_id");
  });

  it("parses OpenAPI 3.0 nullable: true as nullable on IR schema", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "API", version: "1.0.0" },
      paths: {
        "/items": {
          post: {
            operationId: "createItem",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      nickname: { type: "string", nullable: true },
                      score: { type: "integer", nullable: true, minimum: 0, maximum: 100 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const ir = parseOpenAPISpec(spec);
    const schema = ir.operations[0].requestBody!.content["application/json"].schema as Extract<
      IRSchema,
      { type: "object" }
    >;

    expect(schema.properties.name.nullable).toBe(false);
    expect(schema.properties.nickname.nullable).toBe(true);
    expect(schema.properties.score.nullable).toBe(true);

    const scoreSchema = schema.properties.score as Extract<IRSchema, { type: "integer" }>;
    expect(scoreSchema.minimum).toBe(0);
    expect(scoreSchema.maximum).toBe(100);
  });

  it("parses 3.0 boolean exclusiveMinimum/Maximum correctly", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "API", version: "1.0.0" },
      paths: {
        "/range": {
          get: {
            operationId: "getRange",
            parameters: [
              {
                name: "value",
                in: "query",
                schema: { type: "number", minimum: 0, maximum: 1, exclusiveMinimum: true, exclusiveMaximum: false },
              },
            ],
          },
        },
      },
    };
    const ir = parseOpenAPISpec(spec);
    const schema = ir.operations[0].parameters[0].schema as Extract<IRSchema, { type: "number" }>;
    expect(schema.exclusiveMinimum).toBe(true);
    expect(schema.exclusiveMaximum).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OpenAPI 3.1 parsing
// ---------------------------------------------------------------------------
describe("parseOpenAPISpec – OpenAPI 3.1 spec parsing", () => {
  it("parses 3.1 type array [string, null] as nullable string", () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "API 3.1", version: "1.0.0" },
      paths: {
        "/items": {
          post: {
            operationId: "createItem",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      label: { type: ["string", "null"] },
                      count: { type: ["integer", "null"] },
                      ratio: { type: ["number", "null"] },
                      active: { type: ["boolean", "null"] },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const ir = parseOpenAPISpec(spec);
    const schema = ir.operations[0].requestBody!.content["application/json"].schema as Extract<
      IRSchema,
      { type: "object" }
    >;

    expect(schema.properties.label.type).toBe("string");
    expect(schema.properties.label.nullable).toBe(true);
    expect(schema.properties.count.type).toBe("integer");
    expect(schema.properties.count.nullable).toBe(true);
    expect(schema.properties.ratio.type).toBe("number");
    expect(schema.properties.ratio.nullable).toBe(true);
    expect(schema.properties.active.type).toBe("boolean");
    expect(schema.properties.active.nullable).toBe(true);
  });

  it("parses 3.1 numeric exclusiveMinimum/Maximum as boundary values", () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Boundaries", version: "1.0.0" },
      paths: {
        "/data": {
          post: {
            operationId: "postData",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      qty: { type: "integer", exclusiveMinimum: 0, exclusiveMaximum: 100 },
                      price: { type: "number", exclusiveMinimum: 0.01 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const ir = parseOpenAPISpec(spec);
    const schema = ir.operations[0].requestBody!.content["application/json"].schema as Extract<
      IRSchema,
      { type: "object" }
    >;
    const qty = schema.properties.qty as Extract<IRSchema, { type: "integer" }>;
    const price = schema.properties.price as Extract<IRSchema, { type: "number" }>;

    expect(qty.exclusiveMinimum).toBe(0);
    expect(qty.exclusiveMaximum).toBe(100);
    expect(price.exclusiveMinimum).toBe(0.01);
  });

  it("parses 3.1 schema with type: 'null' standalone", () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Null API", version: "1.0.0" },
      paths: {
        "/null-test": {
          get: {
            operationId: "nullTest",
            parameters: [
              { name: "nothing", in: "query", schema: { type: "null" } },
            ],
          },
        },
      },
    };
    const ir = parseOpenAPISpec(spec);
    expect(ir.operations[0].parameters[0].schema.type).toBe("null");
  });

  it("parses 3.1 spec with array items having uniqueItems constraint", () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Array API", version: "1.0.0" },
      paths: {
        "/tags": {
          post: {
            operationId: "setTags",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { type: "string" },
                    uniqueItems: true,
                    minItems: 1,
                    maxItems: 20,
                  },
                },
              },
            },
          },
        },
      },
    };
    const ir = parseOpenAPISpec(spec);
    const schema = ir.operations[0].requestBody!.content["application/json"].schema as Extract<
      IRSchema,
      { type: "array" }
    >;
    expect(schema.type).toBe("array");
    expect(schema.uniqueItems).toBe(true);
    expect(schema.minItems).toBe(1);
    expect(schema.maxItems).toBe(20);
    expect(schema.items.type).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// OpenAPIParseError identity
// ---------------------------------------------------------------------------
describe("OpenAPIParseError", () => {
  it("is instanceof Error and OpenAPIParseError", () => {
    const err = new OpenAPIParseError("bad spec", "openapi");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OpenAPIParseError);
    expect(err.name).toBe("OpenAPIParseError");
    expect(err.field).toBe("openapi");
    expect(err.message).toBe("bad spec");
  });

  it("works with field undefined when not supplied", () => {
    const err = new OpenAPIParseError("unknown error");
    expect(err.field).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// JSON and YAML spec parsing support
// ---------------------------------------------------------------------------
describe("parseSpecContent & YAML / JSON spec parsing", () => {
  const sampleYaml = `
openapi: 3.0.3
info:
  title: Sample YAML API
  version: 1.0.0
paths:
  /ping:
    get:
      operationId: getPing
      responses:
        "200":
          description: OK
`;

  const sampleJson = JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Sample JSON API", version: "2.0.0" },
    paths: {
      "/health": {
        get: {
          operationId: "getHealth",
          responses: { "200": { description: "OK" } },
        },
      },
    },
  });

  it("parses valid YAML spec content with .yaml extension hint", () => {
    const raw = parseSpecContent(sampleYaml, "spec.yaml") as Record<string, unknown>;
    expect(raw.openapi).toBe("3.0.3");
    expect((raw.info as Record<string, unknown>).title).toBe("Sample YAML API");
  });

  it("parses valid YAML spec content with .yml extension hint", () => {
    const raw = parseSpecContent(sampleYaml, "spec.yml") as Record<string, unknown>;
    expect(raw.openapi).toBe("3.0.3");
    expect((raw.info as Record<string, unknown>).title).toBe("Sample YAML API");
  });

  it("parses valid JSON spec content with .json extension hint", () => {
    const raw = parseSpecContent(sampleJson, "spec.json") as Record<string, unknown>;
    expect(raw.openapi).toBe("3.1.0");
    expect((raw.info as Record<string, unknown>).title).toBe("Sample JSON API");
  });

  it("auto-detects and parses YAML content without extension hint", () => {
    const raw = parseSpecContent(sampleYaml) as Record<string, unknown>;
    expect(raw.openapi).toBe("3.0.3");
    expect((raw.info as Record<string, unknown>).title).toBe("Sample YAML API");
  });

  it("auto-detects and parses JSON content without extension hint", () => {
    const raw = parseSpecContent(sampleJson) as Record<string, unknown>;
    expect(raw.openapi).toBe("3.1.0");
    expect((raw.info as Record<string, unknown>).title).toBe("Sample JSON API");
  });

  it("throws error for malformed JSON with .json hint", () => {
    expect(() => parseSpecContent("{ invalid json", "spec.json")).toThrow();
  });

  it("throws error for malformed YAML with .yaml hint", () => {
    expect(() => parseSpecContent(":\n\t: invalid yaml", "spec.yaml")).toThrow();
  });

  it("allows parseOpenAPISpec to directly parse a YAML string", () => {
    const ir = parseOpenAPISpec(sampleYaml);
    expect(ir.title).toBe("Sample YAML API");
    expect(ir.version).toBe("1.0.0");
    expect(ir.operations).toHaveLength(1);
    expect(ir.operations[0].id).toBe("getPing");
  });

  it("allows parseOpenAPISpec to directly parse a JSON string", () => {
    const ir = parseOpenAPISpec(sampleJson);
    expect(ir.title).toBe("Sample JSON API");
    expect(ir.version).toBe("2.0.0");
    expect(ir.operations).toHaveLength(1);
    expect(ir.operations[0].id).toBe("getHealth");
  });

  it("throws OpenAPIParseError when parseOpenAPISpec receives invalid string content", () => {
    expect(() => parseOpenAPISpec(":\n\t: invalid")).toThrow(OpenAPIParseError);
  });
});
