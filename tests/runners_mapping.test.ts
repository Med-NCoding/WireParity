/**
 * Tests for Step 3.2: Language-Specific Invocation Mapping Model
 *
 * Verifies that:
 * 1. String case converters (camelCase, snake_case, PascalCase) handle various parameter naming styles.
 * 2. TypeScript invocation mapping properly formats named request objects and positional args.
 * 3. Python invocation mapping formats snake_case kwargs.
 * 4. Go invocation mapping structures request struct and path params.
 * 5. SDKInvocationMapper interface and factory return correct language-specific mappers.
 */

import { describe, it, expect } from "vitest";
import { createOperationInputs, type OperationInputs } from "../src/ir/inputs.js";
import {
  toCamelCase,
  toSnakeCase,
  toPascalCase,
  mapToTypeScript,
  mapToPython,
  mapToGo,
  TypeScriptInvocationMapper,
  PythonInvocationMapper,
  GoInvocationMapper,
  getInvocationMapper,
} from "../src/runners/mapping.js";

describe("Casing Utilities", () => {
  it("toCamelCase transforms various formats correctly", () => {
    expect(toCamelCase("Accept-Language")).toBe("acceptLanguage");
    expect(toCamelCase("pet_id")).toBe("petId");
    expect(toCamelCase("petId")).toBe("petId");
    expect(toCamelCase("X-Request-ID")).toBe("xRequestId");
    expect(toCamelCase("limit")).toBe("limit");
    expect(toCamelCase("")).toBe("");
  });

  it("toSnakeCase transforms various formats correctly", () => {
    expect(toSnakeCase("Accept-Language")).toBe("accept_language");
    expect(toSnakeCase("petId")).toBe("pet_id");
    expect(toSnakeCase("pet_id")).toBe("pet_id");
    expect(toSnakeCase("X-Request-ID")).toBe("x_request_id");
    expect(toSnakeCase("limit")).toBe("limit");
    expect(toSnakeCase("")).toBe("");
  });

  it("toPascalCase transforms various formats correctly", () => {
    expect(toPascalCase("Accept-Language")).toBe("AcceptLanguage");
    expect(toPascalCase("pet_id")).toBe("PetId");
    expect(toPascalCase("petId")).toBe("PetId");
    expect(toPascalCase("limit")).toBe("Limit");
    expect(toPascalCase("")).toBe("");
  });
});

describe("TypeScript Invocation Mapping", () => {
  const sampleInputs: OperationInputs = createOperationInputs({
    pathParams: {
      "pet-id": { kind: "string", value: "uuid-1234" },
    },
    queryParams: {
      limit: { kind: "integer", value: 10 },
      status: {
        kind: "array",
        items: [{ kind: "string", value: "available" }],
      },
    },
    headerParams: {
      "Accept-Language": { kind: "string", value: "en-US" },
    },
    body: {
      kind: "object",
      fields: {
        name: { kind: "string", value: "Doggie" },
        status: { kind: "string", value: "available" },
      },
    },
  });

  it("maps to namedObject style with camelCase property names", () => {
    const mapped = mapToTypeScript("getPet", sampleInputs);
    expect(mapped.style).toBe("namedObject");
    if (mapped.style === "namedObject") {
      expect(mapped.params["petId"]).toBe("uuid-1234");
      expect(mapped.params["limit"]).toBe(10);
      expect(mapped.params["status"]).toEqual(["available"]);
      expect(mapped.params["acceptLanguage"]).toBe("en-US");
      expect(mapped.params["body"]).toEqual({ name: "Doggie", status: "available" });
    }
  });

  it("respects custom bodyParamName in TypeScript mapping", () => {
    const mapped = mapToTypeScript("createPet", sampleInputs, {
      bodyParamName: "newPet",
    });
    if (mapped.style === "namedObject") {
      expect(mapped.params["newPet"]).toEqual({ name: "Doggie", status: "available" });
      expect(mapped.params["body"]).toBeUndefined();
    }
  });

  it("maps to positional style when configured", () => {
    const mapped = mapToTypeScript("getPet", sampleInputs, {
      style: "positional",
    });
    expect(mapped.style).toBe("positional");
    if (mapped.style === "positional") {
      expect(mapped.args).toContain("uuid-1234");
      expect(mapped.args).toContain(10);
      expect(mapped.args).toContain("en-US");
    }
  });
});

describe("Python Invocation Mapping", () => {
  const sampleInputs: OperationInputs = createOperationInputs({
    pathParams: {
      petId: { kind: "string", value: "uuid-1234" },
    },
    queryParams: {
      maxResults: { kind: "integer", value: 50 },
    },
    headerParams: {
      "X-Request-ID": { kind: "string", value: "req-999" },
    },
    body: {
      kind: "object",
      fields: {
        category: { kind: "string", value: "dog" },
      },
    },
  });

  it("maps parameters to snake_case kwargs", () => {
    const mapped = mapToPython("findPets", sampleInputs);
    expect(mapped.kwargs["pet_id"]).toBe("uuid-1234");
    expect(mapped.kwargs["max_results"]).toBe(50);
    expect(mapped.kwargs["x_request_id"]).toBe("req-999");
    expect(mapped.kwargs["body"]).toEqual({ category: "dog" });
  });

  it("respects custom bodyParamName for Python mapping", () => {
    const mapped = mapToPython("createPet", sampleInputs, {
      bodyParamName: "petData",
    });
    expect(mapped.kwargs["pet_data"]).toEqual({ category: "dog" });
    expect(mapped.kwargs["body"]).toBeUndefined();
  });
});

describe("Go Invocation Mapping", () => {
  const sampleInputs: OperationInputs = createOperationInputs({
    pathParams: {
      petId: { kind: "string", value: "uuid-1234" },
    },
    queryParams: {
      limit: { kind: "integer", value: 25 },
    },
    headerParams: {
      "Accept-Language": { kind: "string", value: "fr-FR" },
    },
    body: {
      kind: "object",
      fields: {
        tag: { kind: "string", value: "vip" },
      },
    },
  });

  it("separates pathParams and structures requestStruct with PascalCase fields", () => {
    const mapped = mapToGo("getPet", sampleInputs);
    expect(mapped.pathParams["petId"]).toBe("uuid-1234");
    expect(mapped.requestStruct["Limit"]).toBe(25);
    expect(mapped.requestStruct["AcceptLanguage"]).toBe("fr-FR");
    expect(mapped.requestStruct["Body"]).toEqual({ tag: "vip" });
  });
});

describe("SDKInvocationMapper & Factory", () => {
  const inputs = createOperationInputs({
    queryParams: { test: { kind: "string", value: "val" } },
  });

  it("TypeScriptInvocationMapper maps correctly", () => {
    const mapper = new TypeScriptInvocationMapper();
    expect(mapper.language).toBe("typescript");
    const result = mapper.mapInvocation("op", inputs);
    expect(result.style).toBe("namedObject");
  });

  it("PythonInvocationMapper maps correctly", () => {
    const mapper = new PythonInvocationMapper();
    expect(mapper.language).toBe("python");
    const result = mapper.mapInvocation("op", inputs);
    expect(result.kwargs["test"]).toBe("val");
  });

  it("GoInvocationMapper maps correctly", () => {
    const mapper = new GoInvocationMapper();
    expect(mapper.language).toBe("go");
    const result = mapper.mapInvocation("op", inputs);
    expect(result.requestStruct["Test"]).toBe("val");
  });

  it("getInvocationMapper returns appropriate mapper for language", () => {
    expect(getInvocationMapper("typescript")).toBeInstanceOf(TypeScriptInvocationMapper);
    expect(getInvocationMapper("python")).toBeInstanceOf(PythonInvocationMapper);
    expect(getInvocationMapper("go")).toBeInstanceOf(GoInvocationMapper);
    expect(getInvocationMapper("mock")).toBeInstanceOf(TypeScriptInvocationMapper);
  });
});
