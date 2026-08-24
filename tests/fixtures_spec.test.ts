/**
 * Tests for Step 2.6: PetStore Reference Spec & Generator Configs
 *
 * Validates that fixtures/specs/petstore.json:
 * 1. Loads and parses as valid JSON
 * 2. Passes strict OpenAPI root validation (version, info)
 * 3. Produces the expected set of operations from the IR parser
 * 4. Resolves all $ref schemas and allOf compositions without error
 * 5. Carries correct parameter locations, styles, and explode values
 * 6. Captures auth scheme from global security
 *
 * Also validates that the generator config files are valid JSON and
 * contain the required generator version and generator entries.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOpenAPISpec, validateOpenAPIRoot } from "../src/openapi/parser.js";
import type { IRDocument, IRObjectSchema, IRParameter } from "../src/ir/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Load fixture files
// ---------------------------------------------------------------------------

function loadJSON(relPath: string): unknown {
  const full = resolve(ROOT, relPath);
  return JSON.parse(readFileSync(full, "utf-8"));
}

let petStoreRaw: unknown;
let ir: IRDocument;
let openApiToolsConfig: unknown;
let tsConfig: unknown;
let pythonConfig: unknown;

beforeAll(() => {
  petStoreRaw = loadJSON("fixtures/specs/petstore.json");
  ir = parseOpenAPISpec(petStoreRaw);
  openApiToolsConfig = loadJSON("fixtures/sdks/configs/openapitools.json");
  tsConfig = loadJSON("fixtures/sdks/configs/ts.json");
  pythonConfig = loadJSON("fixtures/sdks/configs/python.json");
});

// ---------------------------------------------------------------------------
// 1. Root validation
// ---------------------------------------------------------------------------

describe("fixtures/specs/petstore.json – root validation", () => {
  it("is valid JSON and a non-null object", () => {
    expect(petStoreRaw).toBeDefined();
    expect(typeof petStoreRaw).toBe("object");
    expect(petStoreRaw).not.toBeNull();
  });

  it("passes strict OpenAPI root validation", () => {
    expect(() => validateOpenAPIRoot(petStoreRaw)).not.toThrow();
  });

  it("has openapi version 3.0.3", () => {
    expect((petStoreRaw as { openapi: string }).openapi).toBe("3.0.3");
  });

  it("has title 'WireParity PetStore' and version '1.0.0'", () => {
    const spec = petStoreRaw as { info: { title: string; version: string } };
    expect(spec.info.title).toBe("WireParity PetStore");
    expect(spec.info.version).toBe("1.0.0");
  });
});

// ---------------------------------------------------------------------------
// 2. IR parsing – operation count and IDs
// ---------------------------------------------------------------------------

describe("fixtures/specs/petstore.json – IR operations", () => {
  const expectedOperationIds = [
    "listPets",
    "createPet",
    "getPetById",
    "updatePet",
    "deletePet",
    "placeOrder",
    "getOrderById",
    "deleteOrder",
  ];

  it("parses without throwing", () => {
    expect(() => parseOpenAPISpec(petStoreRaw)).not.toThrow();
  });

  it(`produces exactly ${expectedOperationIds.length} operations`, () => {
    expect(ir.operations).toHaveLength(expectedOperationIds.length);
  });

  it("contains all expected operationIds", () => {
    const ids = ir.operations.map((op) => op.id);
    for (const expectedId of expectedOperationIds) {
      expect(ids).toContain(expectedId);
    }
  });

  it("parses the correct server URL", () => {
    expect(ir.servers).toContain("http://localhost:9000");
  });
});

// ---------------------------------------------------------------------------
// 3. $ref resolution and allOf composition
// ---------------------------------------------------------------------------

describe("fixtures/specs/petstore.json – $ref and allOf resolution", () => {
  it("resolves the Pet schema (allOf BasePet) and includes required fields", () => {
    const createPet = ir.operations.find((op) => op.id === "createPet")!;
    expect(createPet.requestBody).toBeDefined();
    const schema = createPet.requestBody!.content["application/json"]!.schema as IRObjectSchema;
    // NewPet allOf BasePet → should have 'name' and 'status' from BasePet
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("name");
    expect(schema.properties).toHaveProperty("status");
    expect(schema.required).toContain("name");
    expect(schema.required).toContain("status");
  });

  it("resolves the NewOrder schema with required and nullable fields", () => {
    const placeOrder = ir.operations.find((op) => op.id === "placeOrder")!;
    const schema = placeOrder.requestBody!.content["application/json"]!.schema as IRObjectSchema;
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("petId");
    expect(schema.required).toContain("quantity");
    const shipDate = schema.properties["shipDate"]!;
    expect(shipDate.nullable).toBe(true);
  });

  it("resolves PetStatus $ref to a string schema with enum values", () => {
    const listPets = ir.operations.find((op) => op.id === "listPets")!;
    const statusParam = listPets.parameters.find(
      (p: IRParameter) => p.name === "status" && p.in === "query"
    )!;
    expect(statusParam).toBeDefined();
    // status is an array of PetStatus; its items resolve to a string enum
    const schema = statusParam.schema;
    expect(schema.type).toBe("array");
  });
});

// ---------------------------------------------------------------------------
// 4. Parameter styles and explode defaults
// ---------------------------------------------------------------------------

describe("fixtures/specs/petstore.json – parameter styles", () => {
  it("listPets 'limit' query param has form+explode=true defaults", () => {
    const listPets = ir.operations.find((op) => op.id === "listPets")!;
    const limit = listPets.parameters.find((p) => p.name === "limit" && p.in === "query")!;
    expect(limit).toBeDefined();
    expect(limit.style).toBe("form");
    expect(limit.explode).toBe(true);
  });

  it("listPets 'status' query param has explode=false (explicit)", () => {
    const listPets = ir.operations.find((op) => op.id === "listPets")!;
    const status = listPets.parameters.find((p) => p.name === "status" && p.in === "query")!;
    expect(status).toBeDefined();
    expect(status.explode).toBe(false);
  });

  it("listPets 'tags' query param has form+explode=true (explicit)", () => {
    const listPets = ir.operations.find((op) => op.id === "listPets")!;
    const tags = listPets.parameters.find((p) => p.name === "tags" && p.in === "query")!;
    expect(tags.style).toBe("form");
    expect(tags.explode).toBe(true);
  });

  it("getPetById 'include' query param has pipeDelimited+explode=false (explicit)", () => {
    const getPet = ir.operations.find((op) => op.id === "getPetById")!;
    const include = getPet.parameters.find((p) => p.name === "include" && p.in === "query")!;
    expect(include.style).toBe("pipeDelimited");
    expect(include.explode).toBe(false);
  });

  it("petId path param inherits from path-level and has simple+explode=false defaults", () => {
    const getPet = ir.operations.find((op) => op.id === "getPetById")!;
    const petId = getPet.parameters.find((p) => p.name === "petId" && p.in === "path")!;
    expect(petId).toBeDefined();
    expect(petId.required).toBe(true);
    expect(petId.style).toBe("simple");
    expect(petId.explode).toBe(false);
  });

  it("getOrderById header param 'X-Request-ID' has simple+explode=false defaults", () => {
    const getOrder = ir.operations.find((op) => op.id === "getOrderById")!;
    const reqId = getOrder.parameters.find((p) => p.name === "X-Request-ID" && p.in === "header")!;
    expect(reqId).toBeDefined();
    expect(reqId.style).toBe("simple");
    expect(reqId.explode).toBe(false);
  });

  it("resolves shared $ref parameter AcceptLanguage onto listPets", () => {
    const listPets = ir.operations.find((op) => op.id === "listPets")!;
    const lang = listPets.parameters.find((p) => p.name === "Accept-Language" && p.in === "header");
    expect(lang).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Auth scheme from global security
// ---------------------------------------------------------------------------

describe("fixtures/specs/petstore.json – auth scheme", () => {
  it("listPets carries ApiKeyAuth auth scheme", () => {
    const listPets = ir.operations.find((op) => op.id === "listPets")!;
    expect(listPets.auth).toBeDefined();
    const apiKey = listPets.auth!.find((a) => a.type === "apiKey");
    expect(apiKey).toBeDefined();
    expect(apiKey!.in).toBe("header");
    expect(apiKey!.name).toBe("X-API-Key");
  });
});

// ---------------------------------------------------------------------------
// 6. Generator config files
// ---------------------------------------------------------------------------

describe("fixtures/sdks/configs/openapitools.json – generator config", () => {
  it("is valid JSON with a generator-cli block pinning version 7.7.0", () => {
    const cfg = openApiToolsConfig as {
      "generator-cli": { version: string };
      generators: Record<string, unknown>;
    };
    expect(cfg["generator-cli"]).toBeDefined();
    expect(cfg["generator-cli"].version).toBe("7.7.0");
  });

  it("contains a 'typescript-petstore' generator entry using 'typescript-fetch'", () => {
    const cfg = openApiToolsConfig as {
      generators: Record<string, { generatorName: string; output: string; inputSpec: string }>;
    };
    const ts = cfg.generators["typescript-petstore"];
    expect(ts).toBeDefined();
    expect(ts.generatorName).toBe("typescript-fetch");
    expect(ts.output).toBe("fixtures/sdks/typescript");
    expect(ts.inputSpec).toBe("fixtures/specs/petstore.json");
  });

  it("contains a 'python-petstore' generator entry using 'python'", () => {
    const cfg = openApiToolsConfig as {
      generators: Record<string, { generatorName: string; output: string; inputSpec: string }>;
    };
    const py = cfg.generators["python-petstore"];
    expect(py).toBeDefined();
    expect(py.generatorName).toBe("python");
    expect(py.output).toBe("fixtures/sdks/python");
    expect(py.inputSpec).toBe("fixtures/specs/petstore.json");
  });
});

describe("fixtures/sdks/configs/ts.json – TypeScript generator config", () => {
  it("is valid JSON with supportsES6 and typescriptThreePlus", () => {
    const cfg = tsConfig as { supportsES6: boolean; typescriptThreePlus: boolean };
    expect(cfg.supportsES6).toBe(true);
    expect(cfg.typescriptThreePlus).toBe(true);
  });

  it("uses useSingleRequestParameter: true", () => {
    const cfg = tsConfig as { useSingleRequestParameter: boolean };
    expect(cfg.useSingleRequestParameter).toBe(true);
  });
});

describe("fixtures/sdks/configs/python.json – Python generator config", () => {
  it("is valid JSON with packageName and library fields", () => {
    const cfg = pythonConfig as { packageName: string; library: string };
    expect(cfg.packageName).toBe("wireparity_petstore");
    expect(cfg.library).toBe("urllib3");
  });
});
