import { describe, expect, it } from "vitest";
import {
  type IRDocument,
  type IRObjectValue,
  type IRSchema,
  parseOpenAPISpec,
} from "../src/index.js";

describe("IR and OpenAPI Parser", () => {
  it("creates and inspects IR runtime values", () => {
    const userPayload: IRObjectValue = {
      kind: "object",
      fields: {
        id: { kind: "integer", value: 42 },
        name: { kind: "string", value: "Alice" },
        isActive: { kind: "boolean", value: true },
        createdAt: { kind: "date-time", value: "2026-08-21T12:00:00Z" },
        tags: {
          kind: "array",
          items: [
            { kind: "string", value: "admin" },
            { kind: "string", value: "staff" },
          ],
        },
      },
    };

    expect(userPayload.kind).toBe("object");
    expect(userPayload.fields.id.kind).toBe("integer");
    expect(userPayload.fields.tags.kind).toBe("array");
  });

  it("parses a minimal OpenAPI 3.0 spec with operations and schemas", () => {
    const spec = {
      openapi: "3.0.3",
      info: {
        title: "User Management API",
        version: "1.0.0",
      },
      servers: [{ url: "https://api.example.com/v1" }],
      paths: {
        "/users/{userId}": {
          parameters: [
            {
              name: "userId",
              in: "path",
              required: true,
              schema: { type: "integer", format: "int64" },
            },
          ],
          get: {
            operationId: "getUser",
            summary: "Get user by ID",
            parameters: [
              {
                name: "includeDetails",
                in: "query",
                schema: { type: "boolean" },
              },
            ],
          },
          put: {
            operationId: "updateUser",
            summary: "Update an existing user",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/UpdateUserRequest" },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          UpdateUserRequest: {
            type: "object",
            required: ["email"],
            properties: {
              email: { type: "string", format: "email" },
              nickname: { type: "string", nullable: true },
              role: { type: "string", enum: ["admin", "member", "guest"] },
            },
          },
        },
      },
    };

    const ir: IRDocument = parseOpenAPISpec(spec);

    expect(ir.title).toBe("User Management API");
    expect(ir.version).toBe("1.0.0");
    expect(ir.servers).toEqual(["https://api.example.com/v1"]);
    expect(ir.operations).toHaveLength(2);

    const getOp = ir.operations.find((op) => op.method === "GET");
    expect(getOp).toBeDefined();
    expect(getOp?.id).toBe("getUser");
    expect(getOp?.path).toBe("/users/{userId}");
    expect(getOp?.parameters).toHaveLength(2);

    const pathParam = getOp?.parameters.find((p) => p.name === "userId");
    expect(pathParam?.in).toBe("path");
    expect(pathParam?.required).toBe(true);
    expect(pathParam?.schema).toEqual({
      type: "integer",
      format: "int64",
      enum: undefined,
      minimum: undefined,
      maximum: undefined,
      exclusiveMinimum: undefined,
      exclusiveMaximum: undefined,
      multipleOf: undefined,
      nullable: false,
    });

    const queryParam = getOp?.parameters.find((p) => p.name === "includeDetails");
    expect(queryParam?.in).toBe("query");
    expect(queryParam?.required).toBe(false);

    const putOp = ir.operations.find((op) => op.method === "PUT");
    expect(putOp).toBeDefined();
    expect(putOp?.id).toBe("updateUser");
    expect(putOp?.requestBody?.required).toBe(true);

    const jsonSchema = putOp?.requestBody?.content["application/json"]?.schema as Extract<
      IRSchema,
      { type: "object" }
    >;
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.required).toEqual(["email"]);
    expect(jsonSchema.properties.email).toEqual({
      type: "string",
      format: "email",
      enum: undefined,
      pattern: undefined,
      minLength: undefined,
      maxLength: undefined,
      nullable: false,
    });
    expect(jsonSchema.properties.nickname.nullable).toBe(true);
    expect(jsonSchema.properties.role).toEqual({
      type: "string",
      format: undefined,
      enum: ["admin", "member", "guest"],
      pattern: undefined,
      minLength: undefined,
      maxLength: undefined,
      nullable: false,
    });
  });

  it("resolves nested components and allOf composition", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Pet Store", version: "2.0.0" },
      paths: {
        "/pets": {
          post: {
            operationId: "createPet",
            requestBody: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Dog" },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Pet: {
            type: "object",
            required: ["id", "name"],
            properties: {
              id: { type: "integer" },
              name: { type: "string" },
            },
          },
          Dog: {
            allOf: [
              { $ref: "#/components/schemas/Pet" },
              {
                type: "object",
                required: ["pack"],
                properties: {
                  pack: { type: "string" },
                },
              },
            ],
          },
        },
      },
    };

    const ir = parseOpenAPISpec(spec);
    const postOp = ir.operations[0];
    const schema = postOp.requestBody?.content["application/json"].schema as Extract<
      IRSchema,
      { type: "object" }
    >;

    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["id", "name", "pack"]));
    expect(schema.required).toEqual(expect.arrayContaining(["id", "name", "pack"]));
  });

  it("handles OpenAPI 3.1 nullable type arrays", () => {
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
                      title: { type: ["string", "null"] },
                      count: { type: ["integer", "null"] },
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
    const postOp = ir.operations[0];
    const schema = postOp.requestBody?.content["application/json"].schema as Extract<
      IRSchema,
      { type: "object" }
    >;

    expect(schema.properties.title.type).toBe("string");
    expect(schema.properties.title.nullable).toBe(true);
    expect(schema.properties.count.type).toBe("integer");
    expect(schema.properties.count.nullable).toBe(true);
  });
});
