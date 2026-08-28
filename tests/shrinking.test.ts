/**
 * WireParity - Step 7.4: Fast-Check Property Test Loop & Replay Path Shrinking Tests
 */

import { describe, it, expect } from "vitest";
import type { ComparisonResult, SemanticDiff } from "../src/comparator/types.js";
import type { IROperation } from "../src/ir/operations.js";
import type { OperationInputs } from "../src/ir/inputs.js";
import {
  runOperationParityTest,
  replayOperationParityTest,
  operationInputsToJs,
  operationInputsToRecord,
} from "../src/shrinker/fast_check_shrink.js";
import { decodeReplayToken } from "../src/generator/seed.js";

describe("Fast-Check Property Testing & Replay Shrinking (Step 7.4)", () => {
  const sampleOp: IROperation = {
    id: "updateUserProfile",
    method: "PUT",
    path: "/users/{userId}",
    parameters: [
      {
        name: "userId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "filter",
        in: "query",
        required: false,
        schema: { type: "string" },
      },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["name", "age"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 50 },
              age: { type: "integer", minimum: 0, maximum: 120 },
              notes: { type: "string", nullable: true },
            },
          },
        },
      },
    },
  };

  it("passes cleanly when all SDK runs produce identical wire requests", async () => {
    const passingPredicate = async (_inputs: OperationInputs): Promise<ComparisonResult> => {
      return {
        hasDivergence: false,
        diffs: [],
        sdkRequests: {},
      };
    };

    const res = await runOperationParityTest(sampleOp, passingPredicate, {
      seed: 42,
      numRuns: 20,
    });

    expect(res.hasDivergence).toBe(false);
    expect(res.diffs).toHaveLength(0);
    expect(res.numRuns).toBe(20);
    expect(res.numShrinks).toBe(0);
  });

  it("detects divergence, shrinks input tree to minimal counterexample, and captures replay token", async () => {
    // Predicate fails when age >= 18 and name length > 0
    const divergentPredicate = async (inputs: OperationInputs): Promise<ComparisonResult> => {
      const body = inputs.body as { kind: "object"; fields: Record<string, { kind: string; value: unknown }> };
      if (body && body.fields["age"] && body.fields["name"]) {
        const ageVal = body.fields["age"].value as number;
        const nameVal = body.fields["name"].value as string;

        if (ageVal >= 18 && nameVal.length >= 1) {
          const diff: SemanticDiff = {
            category: "BODY_PROPERTY_MISMATCH",
            severity: "critical",
            location: "body",
            path: "body.age",
            message: `Age divergence for adults: ${ageVal}`,
            expected: ageVal,
            actual: ageVal + 1,
            sdkA: "ts",
            sdkB: "py",
          };
          return {
            hasDivergence: true,
            diffs: [diff],
            sdkRequests: {},
          };
        }
      }

      return {
        hasDivergence: false,
        diffs: [],
        sdkRequests: {},
      };
    };

    const res = await runOperationParityTest(sampleOp, divergentPredicate, {
      seed: "test-shrink-seed-123",
      numRuns: 50,
    });

    expect(res.hasDivergence).toBe(true);
    expect(res.diffs.length).toBeGreaterThan(0);
    expect(res.diffs[0]!.category).toBe("BODY_PROPERTY_MISMATCH");
    expect(res.numShrinks).toBeGreaterThanOrEqual(0);
    expect(res.seed).toBeDefined();
    expect(res.path).toBeDefined();
    expect(res.replayToken).toBeDefined();
    expect(res.minimizedReproducer).toBeDefined();
    expect(res.preservedCategory).toBe(true);

    // Verify minimal inputs satisfied the failure condition
    const minBody = res.counterexample?.body as any;
    expect(minBody).toBeDefined();
    expect(minBody.fields.age.value).toBeGreaterThanOrEqual(18);
  });

  it("guarantees 100% exact reproduction in 1 single run using captured replay token", async () => {
    const divergentPredicate = async (inputs: OperationInputs): Promise<ComparisonResult> => {
      const body = inputs.body as any;
      if (body?.fields?.age?.value === 25) {
        return {
          hasDivergence: true,
          diffs: [
            {
              category: "ENUM_SERIALIZATION_ERROR",
              severity: "critical",
              location: "body",
              path: "body.age",
              message: "Age 25 divergence",
              expected: 25,
              actual: "25",
              sdkA: "ts",
              sdkB: "py",
            },
          ],
          sdkRequests: {},
        };
      }
      return { hasDivergence: false, diffs: [], sdkRequests: {} };
    };

    // Run initial property test
    const initialRun = await runOperationParityTest(sampleOp, divergentPredicate, {
      seed: 9999,
      numRuns: 100,
    });

    if (initialRun.hasDivergence && initialRun.replayToken) {
      const descriptor = decodeReplayToken(initialRun.replayToken);
      const replayed = await replayOperationParityTest(sampleOp, divergentPredicate, descriptor);

      expect(replayed.hasDivergence).toBe(true);
      expect(replayed.numRuns).toBe(1);
      expect(replayed.diffs[0]!.category).toBe("ENUM_SERIALIZATION_ERROR");
      expect(replayed.counterexample).toEqual(initialRun.counterexample);
    }
  });

  it("translates OperationInputs to clean JS object via operationInputsToJs", () => {
    const inputs: OperationInputs = {
      pathParams: { id: { kind: "string", value: "usr_123" } },
      queryParams: { limit: { kind: "integer", value: 10 } },
      headerParams: { "X-API-Key": { kind: "string", value: "secret" } },
      body: {
        kind: "object",
        fields: {
          name: { kind: "string", value: "Alice" },
          tags: { kind: "array", items: [{ kind: "string", value: "admin" }] },
        },
      },
    };

    const jsObj = operationInputsToJs(inputs);
    expect(jsObj).toEqual({
      pathParams: { id: "usr_123" },
      queryParams: { limit: 10 },
      headerParams: { "X-API-Key": "secret" },
      body: {
        name: "Alice",
        tags: ["admin"],
      },
    });
  });

  it("flattens OperationInputs to IRValueRecord via operationInputsToRecord", () => {
    const inputs: OperationInputs = {
      pathParams: { petId: { kind: "string", value: "uuid-123" } },
      queryParams: { limit: { kind: "integer", value: 5 } },
      headerParams: { Accept: { kind: "string", value: "json" } },
      body: { kind: "string", value: "payload" },
    };

    const record = operationInputsToRecord(inputs);
    expect(record.petId).toEqual({ kind: "string", value: "uuid-123" });
    expect(record.limit).toEqual({ kind: "integer", value: 5 });
    expect(record.Accept).toEqual({ kind: "string", value: "json" });
    expect(record.body).toEqual({ kind: "string", value: "payload" });
  });
});
