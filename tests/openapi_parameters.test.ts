/**
 * Tests for Step 2.3: Parameter & Path-Level Merging
 *
 * Verifies that:
 * 1. Path-level parameters are inherited by all operations on that path.
 * 2. Operation-level parameters override path-level ones (same name + in).
 * 3. Style and explode defaults are applied correctly per OpenAPI 3.x spec:
 *    - query  → style: "form",   explode: true
 *    - path   → style: "simple", explode: false
 *    - header → style: "simple", explode: false
 *    - cookie → style: "form",   explode: true
 * 4. Explicit style / explode values on parameters are preserved as-is.
 * 5. $ref parameters at path-level and operation-level are resolved before merging.
 */

import { describe, it, expect } from "vitest";
import { parseOpenAPISpec } from "../src/openapi/parser.js";
import type { IRParameter } from "../src/ir/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findParam(params: IRParameter[], name: string, location: string): IRParameter {
  const p = params.find((p) => p.name === name && p.in === location);
  if (!p) throw new Error(`Parameter "${name}" in "${location}" not found`);
  return p;
}

// ---------------------------------------------------------------------------
// 1. Default style & explode per location
// ---------------------------------------------------------------------------

describe("parameter style/explode defaults", () => {
  it("applies form+explode=true defaults for query parameters", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/search": {
          get: {
            operationId: "search",
            parameters: [{ name: "q", in: "query", schema: { type: "string" } }],
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const param = findParam(doc.operations[0]!.parameters, "q", "query");
    expect(param.style).toBe("form");
    expect(param.explode).toBe(true);
  });

  it("applies simple+explode=false defaults for path parameters", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/users/{id}": {
          get: {
            operationId: "getUser",
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const param = findParam(doc.operations[0]!.parameters, "id", "path");
    expect(param.style).toBe("simple");
    expect(param.explode).toBe(false);
  });

  it("applies simple+explode=false defaults for header parameters", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/items": {
          get: {
            operationId: "listItems",
            parameters: [{ name: "X-Custom", in: "header", schema: { type: "string" } }],
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const param = findParam(doc.operations[0]!.parameters, "X-Custom", "header");
    expect(param.style).toBe("simple");
    expect(param.explode).toBe(false);
  });

  it("applies form+explode=true defaults for cookie parameters", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/session": {
          get: {
            operationId: "getSession",
            parameters: [{ name: "sessionId", in: "cookie", schema: { type: "string" } }],
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const param = findParam(doc.operations[0]!.parameters, "sessionId", "cookie");
    expect(param.style).toBe("form");
    expect(param.explode).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Explicit style & explode values are preserved
// ---------------------------------------------------------------------------

describe("parameter explicit style/explode preserved", () => {
  it("preserves explicit spaceDelimited style with explode=false", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/items": {
          get: {
            operationId: "listItems",
            parameters: [
              {
                name: "tags",
                in: "query",
                style: "spaceDelimited",
                explode: false,
                schema: { type: "array", items: { type: "string" } },
              },
            ],
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const param = findParam(doc.operations[0]!.parameters, "tags", "query");
    expect(param.style).toBe("spaceDelimited");
    expect(param.explode).toBe(false);
  });

  it("preserves explicit pipeDelimited style", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/items": {
          get: {
            operationId: "listItems",
            parameters: [
              {
                name: "ids",
                in: "query",
                style: "pipeDelimited",
                explode: false,
                schema: { type: "array", items: { type: "integer" } },
              },
            ],
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const param = findParam(doc.operations[0]!.parameters, "ids", "query");
    expect(param.style).toBe("pipeDelimited");
    expect(param.explode).toBe(false);
  });

  it("preserves explicit label style for path parameter", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/map/{point}": {
          get: {
            operationId: "getPoint",
            parameters: [
              {
                name: "point",
                in: "path",
                required: true,
                style: "label",
                schema: { type: "string" },
              },
            ],
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const param = findParam(doc.operations[0]!.parameters, "point", "path");
    expect(param.style).toBe("label");
    expect(param.explode).toBe(false);
  });

  it("preserves explicit matrix style for path parameter", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/users/{id}": {
          get: {
            operationId: "getUser",
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                style: "matrix",
                schema: { type: "string" },
              },
            ],
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const param = findParam(doc.operations[0]!.parameters, "id", "path");
    expect(param.style).toBe("matrix");
    expect(param.explode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Path-level parameter inheritance
// ---------------------------------------------------------------------------

describe("path-level parameter inheritance", () => {
  it("inherits path-level parameter across all operations on the path", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/users/{id}": {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          get: { operationId: "getUser", parameters: [], responses: {} },
          delete: { operationId: "deleteUser", parameters: [], responses: {} },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    expect(doc.operations).toHaveLength(2);
    for (const op of doc.operations) {
      const id = findParam(op.parameters, "id", "path");
      expect(id.required).toBe(true);
      expect(id.style).toBe("simple");
      expect(id.explode).toBe(false);
    }
  });

  it("operation-level parameter overrides path-level parameter (same name+in)", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/users/{id}": {
          parameters: [
            { name: "id", in: "path", required: true, description: "path-level", schema: { type: "string" } },
          ],
          get: {
            operationId: "getUser",
            parameters: [
              { name: "id", in: "path", required: true, description: "op-level-override", schema: { type: "integer" } },
            ],
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const op = doc.operations[0]!;
    const id = findParam(op.parameters, "id", "path");
    expect(id.description).toBe("op-level-override");
    expect(id.schema.type).toBe("integer");
  });

  it("operation-level parameters coexist with path-level parameters of different name", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/users/{id}": {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          get: {
            operationId: "getUser",
            parameters: [{ name: "expand", in: "query", schema: { type: "string" } }],
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const params = doc.operations[0]!.parameters;
    expect(params).toHaveLength(2);
    findParam(params, "id", "path");
    findParam(params, "expand", "query");
  });

  it("no duplication when same parameter exists only at path-level (no op-level params)", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/orgs/{org}": {
          parameters: [{ name: "org", in: "path", required: true, schema: { type: "string" } }],
          get: { operationId: "getOrg", responses: {} },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const params = doc.operations[0]!.parameters;
    expect(params).toHaveLength(1);
    expect(params[0]!.name).toBe("org");
  });
});

// ---------------------------------------------------------------------------
// 4. $ref parameter resolution before merging
// ---------------------------------------------------------------------------

describe("$ref parameter resolution in merging", () => {
  it("resolves $ref at path-level before merging with operation-level params", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      components: {
        parameters: {
          IdParam: { name: "id", in: "path", required: true, schema: { type: "string" } },
        },
      },
      paths: {
        "/users/{id}": {
          parameters: [{ $ref: "#/components/parameters/IdParam" }],
          get: {
            operationId: "getUser",
            parameters: [{ name: "verbose", in: "query", schema: { type: "boolean" } }],
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const params = doc.operations[0]!.parameters;
    expect(params).toHaveLength(2);
    const id = findParam(params, "id", "path");
    expect(id.required).toBe(true);
    const verbose = findParam(params, "verbose", "query");
    expect(verbose.style).toBe("form");
    expect(verbose.explode).toBe(true);
  });

  it("resolves $ref at operation-level overriding path-level param", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      components: {
        parameters: {
          IdParamInt: { name: "id", in: "path", required: true, description: "from-ref", schema: { type: "integer" } },
        },
      },
      paths: {
        "/users/{id}": {
          parameters: [{ name: "id", in: "path", required: true, description: "path-level", schema: { type: "string" } }],
          get: {
            operationId: "getUser",
            parameters: [{ $ref: "#/components/parameters/IdParamInt" }],
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const id = findParam(doc.operations[0]!.parameters, "id", "path");
    expect(id.description).toBe("from-ref");
    expect(id.schema.type).toBe("integer");
  });
});

// ---------------------------------------------------------------------------
// 5. required defaults
// ---------------------------------------------------------------------------

describe("parameter required defaults", () => {
  it("path parameters default to required=true even when omitted", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/users/{id}": {
          get: {
            operationId: "getUser",
            parameters: [{ name: "id", in: "path", schema: { type: "string" } }], // no `required` field
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const id = findParam(doc.operations[0]!.parameters, "id", "path");
    expect(id.required).toBe(true);
  });

  it("non-path parameters default to required=false when omitted", () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/items": {
          get: {
            operationId: "listItems",
            parameters: [{ name: "page", in: "query", schema: { type: "integer" } }], // no `required` field
            responses: {},
          },
        },
      },
    };
    const doc = parseOpenAPISpec(spec);
    const page = findParam(doc.operations[0]!.parameters, "page", "query");
    expect(page.required).toBe(false);
  });
});
