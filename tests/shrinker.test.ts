import { describe, expect, it } from "vitest";
import type { ComparisonResult } from "../src/comparator/types.js";
import type { IROperation, IRValueRecord } from "../src/ir/index.js";
import { shrinkCounterexample } from "../src/shrinker/engine.js";

describe("Counterexample Shrinker", () => {
  it("shrinks a large failing input down to the minimal reproducer", async () => {
    const operation: IROperation = {
      id: "testOp",
      method: "POST",
      path: "/items",
      parameters: [],
    };

    // Initial complex failure input: divergence is triggered only if `flag` is true and `name` contains non-empty string
    const initialInput: IRValueRecord = {
      name: { kind: "string", value: "A very long unnecessary string with words" },
      irrelevantNum: { kind: "integer", value: 12345 },
      irrelevantObj: {
        kind: "object",
        fields: { a: { kind: "string", value: "foo" } },
      },
      flag: { kind: "boolean", value: true },
    };

    // Predicate mimics a divergence occurring only when `flag` is true and `name` is a string
    const predicate = async (input: IRValueRecord): Promise<ComparisonResult> => {
      const hasFlag = input.flag?.kind === "boolean" && input.flag.value === true;
      const hasName = input.name?.kind === "string";

      if (hasFlag && hasName) {
        return {
          hasDivergence: true,
          diffs: [
            {
              category: "BODY_PROPERTY_MISMATCH",
              severity: "critical",
              location: "body",
              path: "body.name",
              message: "divergence reproduced",
              expected: "A",
              actual: "B",
              sdkA: "ts",
              sdkB: "py",
            },
          ],
          sdkRequests: {},
        };
      }

      return {
        hasDivergence: false,
        diffs: [],
        sdkRequests: {},
      };
    };

    const result = await shrinkCounterexample(operation, initialInput, predicate);

    expect(result.lastComparison.hasDivergence).toBe(true);
    expect(result.steps).toBeGreaterThan(0);
    // Irrelevant properties should be stripped
    expect(result.minimizedInput.irrelevantNum).toBeUndefined();
    expect(result.minimizedInput.irrelevantObj).toBeUndefined();
    // Required properties should be minimized
    expect(result.minimizedInput.flag).toEqual({ kind: "boolean", value: true });
    expect(result.minimizedInput.name).toEqual({ kind: "string", value: "" }); // string shrunk to empty
  });
});
