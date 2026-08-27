/**
 * WireParity - Step 6.5: Operation Input Schema Synthesizer Tests
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";

import { parseOpenAPISpec } from "../src/openapi/parser.js";
import {
  operationInputsArbitrary,
  synthesizeOperationInputs,
} from "../src/generator/index.js";
import { isOperationInputs, type OperationInputs } from "../src/ir/inputs.js";
import type { IRDocument, IROperation } from "../src/ir/index.js";
import type { IRObjectValue, IRStringValue } from "../src/ir/values.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PETSTORE_PATH = resolve(__dirname, "../fixtures/specs/petstore.json");

let ir: IRDocument;

beforeAll(() => {
  const raw = JSON.parse(readFileSync(PETSTORE_PATH, "utf-8"));
  ir = parseOpenAPISpec(raw);
});

describe("Operation Input Schema Synthesizer (Step 6.5)", () => {
  // ── PetStore Spec Synthesis ─────────────────────────────────────────────────

  describe("PetStore Operations Input Synthesis", () => {
    it("synthesizes valid inputs for listPets (query & header params, no body)", () => {
      const op = ir.operations.find((o) => o.id === "listPets")!;
      expect(op).toBeDefined();

      fc.assert(
        fc.property(operationInputsArbitrary(op), (inputs) => {
          expect(isOperationInputs(inputs)).toBe(true);
          expect(Object.keys(inputs.pathParams).length).toBe(0);
          expect(inputs.body).toBeUndefined();

          // If limit is generated, must be integer in [1, 100]
          if ("limit" in inputs.queryParams) {
            const limitVal = inputs.queryParams["limit"]!;
            expect(limitVal.kind).toBe("integer");
            if (limitVal.kind === "integer") {
              expect(limitVal.value).toBeGreaterThanOrEqual(1);
              expect(limitVal.value).toBeLessThanOrEqual(100);
            }
          }

          // If status is generated, must be array of enum values
          if ("status" in inputs.queryParams) {
            const statusVal = inputs.queryParams["status"]!;
            expect(statusVal.kind).toBe("array");
          }

          // If tags is generated, must be array of strings
          if ("tags" in inputs.queryParams) {
            const tagsVal = inputs.queryParams["tags"]!;
            expect(tagsVal.kind).toBe("array");
          }

          // If Accept-Language is generated, must be string
          if ("Accept-Language" in inputs.headerParams) {
            expect(inputs.headerParams["Accept-Language"]!.kind).toBe("string");
          }
        }),
        { numRuns: 100 }
      );
    });

    it("synthesizes valid inputs for createPet (required requestBody, no path params)", () => {
      const op = ir.operations.find((o) => o.id === "createPet")!;
      expect(op).toBeDefined();

      fc.assert(
        fc.property(operationInputsArbitrary(op), (inputs) => {
          expect(isOperationInputs(inputs)).toBe(true);
          expect(Object.keys(inputs.pathParams).length).toBe(0);
          expect(Object.keys(inputs.queryParams).length).toBe(0);

          // Body is required
          expect(inputs.body).toBeDefined();
          expect(inputs.body!.kind).toBe("object");

          const bodyObj = inputs.body as IRObjectValue;
          // Required fields on NewPet (from BasePet) are 'name' and 'status'
          expect(bodyObj.fields["name"]).toBeDefined();
          expect(bodyObj.fields["name"]!.kind).toBe("string");
          expect(bodyObj.fields["status"]).toBeDefined();
          const statusField = bodyObj.fields["status"] as IRStringValue;
          expect(["available", "pending", "sold"]).toContain(statusField.value);
        }),
        { numRuns: 100 }
      );
    });

    it("synthesizes valid inputs for getPetById (required path param petId as uuid, optional query include)", () => {
      const op = ir.operations.find((o) => o.id === "getPetById")!;
      expect(op).toBeDefined();

      fc.assert(
        fc.property(operationInputsArbitrary(op), (inputs) => {
          expect(isOperationInputs(inputs)).toBe(true);
          expect(inputs.body).toBeUndefined();

          // Path param petId is required
          expect(inputs.pathParams["petId"]).toBeDefined();
          expect(inputs.pathParams["petId"]!.kind).toBe("string");

          // Optional query 'include'
          if ("include" in inputs.queryParams) {
            expect(inputs.queryParams["include"]!.kind).toBe("array");
          }
        }),
        { numRuns: 100 }
      );
    });

    it("synthesizes valid inputs for updatePet (path param petId, required requestBody)", () => {
      const op = ir.operations.find((o) => o.id === "updatePet")!;
      expect(op).toBeDefined();

      fc.assert(
        fc.property(operationInputsArbitrary(op), (inputs) => {
          expect(isOperationInputs(inputs)).toBe(true);
          expect(inputs.pathParams["petId"]).toBeDefined();
          expect(inputs.pathParams["petId"]!.kind).toBe("string");

          expect(inputs.body).toBeDefined();
          expect(inputs.body!.kind).toBe("object");
        }),
        { numRuns: 100 }
      );
    });

    it("synthesizes valid inputs for placeOrder (required requestBody with NewOrder)", () => {
      const op = ir.operations.find((o) => o.id === "placeOrder")!;
      expect(op).toBeDefined();

      fc.assert(
        fc.property(operationInputsArbitrary(op), (inputs) => {
          expect(isOperationInputs(inputs)).toBe(true);
          expect(inputs.body).toBeDefined();
          expect(inputs.body!.kind).toBe("object");

          const bodyObj = inputs.body as IRObjectValue;
          // Required on NewOrder: petId (uuid) and quantity (integer)
          expect(bodyObj.fields["petId"]).toBeDefined();
          expect(bodyObj.fields["petId"]!.kind).toBe("string");
          expect(bodyObj.fields["quantity"]).toBeDefined();
          expect(bodyObj.fields["quantity"]!.kind).toBe("integer");
        }),
        { numRuns: 100 }
      );
    });

    it("synthesizes valid inputs for getOrderById (int64 path param orderId, optional header X-Request-ID)", () => {
      const op = ir.operations.find((o) => o.id === "getOrderById")!;
      expect(op).toBeDefined();

      fc.assert(
        fc.property(operationInputsArbitrary(op), (inputs) => {
          expect(isOperationInputs(inputs)).toBe(true);
          expect(inputs.body).toBeUndefined();

          // Path param orderId is required
          expect(inputs.pathParams["orderId"]).toBeDefined();
          expect(inputs.pathParams["orderId"]!.kind).toBe("integer");

          // Header param X-Request-ID
          if ("X-Request-ID" in inputs.headerParams) {
            expect(inputs.headerParams["X-Request-ID"]!.kind).toBe("string");
          }
        }),
        { numRuns: 100 }
      );
    });

    it("synthesizes valid inputs across all operations in petstore IR", () => {
      for (const op of ir.operations) {
        fc.assert(
          fc.property(operationInputsArbitrary(op), (inputs) => {
            expect(isOperationInputs(inputs)).toBe(true);

            // Check all required parameters are present
            for (const param of op.parameters) {
              if (param.required) {
                if (param.in === "path") {
                  expect(inputs.pathParams[param.name]).toBeDefined();
                } else if (param.in === "query") {
                  expect(inputs.queryParams[param.name]).toBeDefined();
                } else if (param.in === "header") {
                  expect(inputs.headerParams[param.name]).toBeDefined();
                }
              }
            }

            // Check required body
            if (op.requestBody?.required) {
              expect(inputs.body).toBeDefined();
            }
          }),
          { numRuns: 30 }
        );
      }
    });
  });

  // ── Deterministic Single Synthesis ──────────────────────────────────────────

  describe("synthesizeOperationInputs helper", () => {
    it("produces deterministic output when given the same seed", () => {
      const op = ir.operations.find((o) => o.id === "createPet")!;
      const input1 = synthesizeOperationInputs(op, 42);
      const input2 = synthesizeOperationInputs(op, 42);

      expect(input1).toEqual(input2);
    });

    it("produces valid inputs when called without seed", () => {
      const op = ir.operations.find((o) => o.id === "listPets")!;
      const input = synthesizeOperationInputs(op);
      expect(isOperationInputs(input)).toBe(true);
    });
  });

  // ── Edge Cases & Cookie Parameters ──────────────────────────────────────────

  describe("Custom Operations & Edge Cases", () => {
    it("handles operation with cookie parameters", () => {
      const customOp: IROperation = {
        id: "testCookieOp",
        method: "GET",
        path: "/cookie-test",
        parameters: [
          {
            name: "session_id",
            in: "cookie",
            required: true,
            schema: { type: "string" },
          },
        ],
      };

      fc.assert(
        fc.property(operationInputsArbitrary(customOp), (inputs) => {
          expect(isOperationInputs(inputs)).toBe(true);
          expect(inputs.cookieParams).toBeDefined();
          expect(inputs.cookieParams!["session_id"]).toBeDefined();
          expect(inputs.cookieParams!["session_id"]!.kind).toBe("string");
        }),
        { numRuns: 50 }
      );
    });

    it("handles completely empty operation (no parameters, no body)", () => {
      const emptyOp: IROperation = {
        id: "ping",
        method: "GET",
        path: "/ping",
        parameters: [],
      };

      const inputs = synthesizeOperationInputs(emptyOp, 123);
      expect(isOperationInputs(inputs)).toBe(true);
      expect(inputs.pathParams).toEqual({});
      expect(inputs.queryParams).toEqual({});
      expect(inputs.headerParams).toEqual({});
      expect(inputs.cookieParams).toBeUndefined();
      expect(inputs.body).toBeUndefined();
    });

    it("exercises optional body presence and absence across runs", () => {
      const optionalBodyOp: IROperation = {
        id: "optionalBodyOp",
        method: "POST",
        path: "/optional-body",
        parameters: [],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { note: { type: "string" } },
              },
            },
          },
        },
      };

      let sawPresent = false;
      let sawAbsent = false;

      fc.assert(
        fc.property(operationInputsArbitrary(optionalBodyOp), (inputs) => {
          if (inputs.body !== undefined) {
            sawPresent = true;
            expect(inputs.body.kind).toBe("object");
          } else {
            sawAbsent = true;
          }
          return true;
        }),
        { numRuns: 200 }
      );

      expect(sawPresent).toBe(true);
      expect(sawAbsent).toBe(true);
    });
  });
});
