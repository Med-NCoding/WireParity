/**
 * WireParity - Step 7.1: OPTIONAL_VS_NULL & Case Leak Classifier Tests
 */

import { describe, it, expect } from "vitest";
import {
  classifyOptionalVsNull,
  isOptionalVsNull,
  detectCasing,
  isCamelCase,
  isSnakeCase,
  camelToSnake,
  snakeToCamel,
  areSameCasingVariant,
  normaliseIdentifier,
  classifyCaseLeakOnKey,
  classifyCaseLeakOnValue,
  scanBodyForNullAndCaseLeaks,
} from "../src/comparator/classifiers/null_and_case.js";

// ─── classifyOptionalVsNull ───────────────────────────────────────────────────

describe("classifyOptionalVsNull", () => {
  it("returns OPTIONAL_VS_NULL when SDK A omits and SDK B sends null", () => {
    const result = classifyOptionalVsNull("body.nickname", undefined, null);
    expect(result).not.toBeNull();
    expect(result!.category).toBe("OPTIONAL_VS_NULL");
    expect(result!.severity).toBe("warning");
    expect(result!.message).toContain("body.nickname");
    expect(result!.message).toContain("omitted");
  });

  it("returns OPTIONAL_VS_NULL when SDK A sends null and SDK B omits", () => {
    const result = classifyOptionalVsNull("body.notes", null, undefined);
    expect(result).not.toBeNull();
    expect(result!.category).toBe("OPTIONAL_VS_NULL");
    expect(result!.message).toContain("body.notes");
  });

  it("returns null when both values are undefined (both omitted)", () => {
    expect(classifyOptionalVsNull("body.field", undefined, undefined)).toBeNull();
  });

  it("returns null when both values are null", () => {
    expect(classifyOptionalVsNull("body.field", null, null)).toBeNull();
  });

  it("returns null when both values are present strings", () => {
    expect(classifyOptionalVsNull("body.name", "Fido", "Fido")).toBeNull();
  });

  it("returns null when values differ but are not null/undefined", () => {
    expect(classifyOptionalVsNull("body.count", 1, 2)).toBeNull();
  });

  it("returns null when one value is 0 (falsy but not null/undefined)", () => {
    expect(classifyOptionalVsNull("body.count", 0, null)).toBeNull();
    expect(classifyOptionalVsNull("body.count", undefined, 0)).toBeNull();
  });

  it("returns null when one value is false (falsy but not null/undefined)", () => {
    expect(classifyOptionalVsNull("body.active", false, undefined)).toBeNull();
  });

  it("returns null when one value is empty string (falsy but not null/undefined)", () => {
    expect(classifyOptionalVsNull("body.tag", "", null)).toBeNull();
  });
});

// ─── isOptionalVsNull ─────────────────────────────────────────────────────────

describe("isOptionalVsNull", () => {
  it("returns true for (undefined, null)", () => {
    expect(isOptionalVsNull(undefined, null)).toBe(true);
  });

  it("returns true for (null, undefined)", () => {
    expect(isOptionalVsNull(null, undefined)).toBe(true);
  });

  it("returns false for (undefined, undefined)", () => {
    expect(isOptionalVsNull(undefined, undefined)).toBe(false);
  });

  it("returns false for (null, null)", () => {
    expect(isOptionalVsNull(null, null)).toBe(false);
  });

  it("returns false for (0, null)", () => {
    expect(isOptionalVsNull(0, null)).toBe(false);
  });
});

// ─── detectCasing ─────────────────────────────────────────────────────────────

describe("detectCasing", () => {
  it("detects camelCase", () => {
    expect(detectCasing("petName")).toBe("camelCase");
    expect(detectCasing("createdAt")).toBe("camelCase");
    expect(detectCasing("userId")).toBe("camelCase");
  });

  it("detects snake_case", () => {
    expect(detectCasing("pet_name")).toBe("snake_case");
    expect(detectCasing("created_at")).toBe("snake_case");
    expect(detectCasing("user_id")).toBe("snake_case");
  });

  it("detects PascalCase", () => {
    expect(detectCasing("PetName")).toBe("PascalCase");
    expect(detectCasing("CreatedAt")).toBe("PascalCase");
  });

  it("detects SCREAMING_SNAKE_CASE", () => {
    expect(detectCasing("PET_NAME")).toBe("SCREAMING_SNAKE_CASE");
    expect(detectCasing("API_KEY")).toBe("SCREAMING_SNAKE_CASE");
  });

  it("detects kebab-case", () => {
    expect(detectCasing("pet-name")).toBe("kebab-case");
    expect(detectCasing("created-at")).toBe("kebab-case");
  });

  it("returns unknown for single lowercase words", () => {
    expect(detectCasing("status")).toBe("unknown");
    expect(detectCasing("name")).toBe("unknown");
  });

  it("returns unknown for empty string", () => {
    expect(detectCasing("")).toBe("unknown");
  });
});

// ─── isCamelCase / isSnakeCase ────────────────────────────────────────────────

describe("isCamelCase", () => {
  it("returns true for camelCase identifiers", () => {
    expect(isCamelCase("petName")).toBe(true);
    expect(isCamelCase("createdAt")).toBe(true);
  });

  it("returns false for snake_case identifiers", () => {
    expect(isCamelCase("pet_name")).toBe(false);
  });

  it("returns false for PascalCase", () => {
    expect(isCamelCase("PetName")).toBe(false);
  });

  it("returns false for single lowercase word", () => {
    expect(isCamelCase("status")).toBe(false);
  });
});

describe("isSnakeCase", () => {
  it("returns true for snake_case identifiers", () => {
    expect(isSnakeCase("pet_name")).toBe(true);
    expect(isSnakeCase("created_at")).toBe(true);
  });

  it("returns false for camelCase", () => {
    expect(isSnakeCase("petName")).toBe(false);
  });

  it("returns false for strings without underscores", () => {
    expect(isSnakeCase("status")).toBe(false);
  });
});

// ─── Conversion Utilities ─────────────────────────────────────────────────────

describe("camelToSnake", () => {
  it("converts camelCase to snake_case", () => {
    expect(camelToSnake("petName")).toBe("pet_name");
    expect(camelToSnake("createdAt")).toBe("created_at");
    expect(camelToSnake("userId")).toBe("user_id");
  });

  it("leaves already snake_case strings unchanged", () => {
    expect(camelToSnake("status")).toBe("status");
    expect(camelToSnake("pet_name")).toBe("pet_name");
  });
});

describe("snakeToCamel", () => {
  it("converts snake_case to camelCase", () => {
    expect(snakeToCamel("pet_name")).toBe("petName");
    expect(snakeToCamel("created_at")).toBe("createdAt");
    expect(snakeToCamel("user_id")).toBe("userId");
  });

  it("leaves already camelCase strings unchanged", () => {
    expect(snakeToCamel("status")).toBe("status");
    expect(snakeToCamel("petName")).toBe("petName");
  });
});

// ─── normaliseIdentifier ──────────────────────────────────────────────────────

describe("normaliseIdentifier", () => {
  it("normalises camelCase to snake_case lowercase", () => {
    expect(normaliseIdentifier("petName")).toBe("pet_name");
    expect(normaliseIdentifier("createdAt")).toBe("created_at");
  });

  it("normalises PascalCase to snake_case lowercase", () => {
    expect(normaliseIdentifier("PetName")).toBe("pet_name");
  });

  it("normalises SCREAMING_SNAKE to lowercase snake", () => {
    expect(normaliseIdentifier("PET_NAME")).toBe("pet_name");
    expect(normaliseIdentifier("API_KEY")).toBe("api_key");
  });

  it("normalises kebab-case to snake_case lowercase", () => {
    expect(normaliseIdentifier("pet-name")).toBe("pet_name");
  });

  it("leaves snake_case unchanged (except lowercasing)", () => {
    expect(normaliseIdentifier("pet_name")).toBe("pet_name");
  });
});

// ─── areSameCasingVariant ─────────────────────────────────────────────────────

describe("areSameCasingVariant", () => {
  it("returns true for camelCase vs snake_case", () => {
    expect(areSameCasingVariant("petName", "pet_name")).toBe(true);
    expect(areSameCasingVariant("createdAt", "created_at")).toBe(true);
    expect(areSameCasingVariant("userId", "user_id")).toBe(true);
  });

  it("returns true for PascalCase vs snake_case", () => {
    expect(areSameCasingVariant("PetName", "pet_name")).toBe(true);
  });

  it("returns true for camelCase vs kebab-case", () => {
    expect(areSameCasingVariant("petName", "pet-name")).toBe(true);
  });

  it("returns false for identical strings", () => {
    expect(areSameCasingVariant("petName", "petName")).toBe(false);
    expect(areSameCasingVariant("pet_name", "pet_name")).toBe(false);
  });

  it("returns false for different words altogether", () => {
    expect(areSameCasingVariant("petName", "ownerName")).toBe(false);
    expect(areSameCasingVariant("status", "category")).toBe(false);
  });
});

// ─── classifyCaseLeakOnKey ────────────────────────────────────────────────────

describe("classifyCaseLeakOnKey", () => {
  it("detects camelCase key vs snake_case key in other SDK", () => {
    const result = classifyCaseLeakOnKey(
      "body",
      "petName",
      ["pet_name", "status"],
      "typescript",
      "python"
    );
    expect(result).not.toBeNull();
    expect(result!.category).toBe("CASE_CONVENTION_LEAK");
    expect(result!.severity).toBe("critical");
    expect(result!.message).toContain("petName");
    expect(result!.message).toContain("pet_name");
    expect(result!.message).toContain("typescript");
    expect(result!.message).toContain("python");
  });

  it("detects snake_case key vs camelCase key in other SDK", () => {
    const result = classifyCaseLeakOnKey(
      "body",
      "created_at",
      ["createdAt", "status"],
      "python",
      "typescript"
    );
    expect(result).not.toBeNull();
    expect(result!.category).toBe("CASE_CONVENTION_LEAK");
  });

  it("returns null when no casing variant is found", () => {
    const result = classifyCaseLeakOnKey(
      "body",
      "petName",
      ["status", "description", "category"],
      "typescript",
      "python"
    );
    expect(result).toBeNull();
  });

  it("returns null when the key is identical in present keys", () => {
    const result = classifyCaseLeakOnKey(
      "body",
      "petName",
      ["petName", "status"],
      "typescript",
      "python"
    );
    expect(result).toBeNull();
  });
});

// ─── classifyCaseLeakOnValue ──────────────────────────────────────────────────

describe("classifyCaseLeakOnValue", () => {
  it("detects camelCase vs snake_case string values", () => {
    const result = classifyCaseLeakOnValue("body.sortKey", "petName", "pet_name");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("CASE_CONVENTION_LEAK");
    expect(result!.message).toContain("petName");
    expect(result!.message).toContain("pet_name");
  });

  it("returns null for non-string values", () => {
    expect(classifyCaseLeakOnValue("body.count", 1, 2)).toBeNull();
    expect(classifyCaseLeakOnValue("body.active", true, false)).toBeNull();
  });

  it("returns null for identical strings", () => {
    expect(classifyCaseLeakOnValue("body.status", "available", "available")).toBeNull();
  });

  it("returns null for strings that are different words (not casing variants)", () => {
    expect(classifyCaseLeakOnValue("body.type", "petName", "ownerName")).toBeNull();
  });

  it("returns null for single-word case differences (not multi-word casing variants)", () => {
    // "status" vs "Status" — single word, both detect as unknown → null
    const result = classifyCaseLeakOnValue("body.status", "status", "Status");
    expect(result).toBeNull();
  });
});

// ─── scanBodyForNullAndCaseLeaks ──────────────────────────────────────────────

describe("scanBodyForNullAndCaseLeaks", () => {
  it("detects OPTIONAL_VS_NULL at top level when body is null vs undefined", () => {
    const out = scanBodyForNullAndCaseLeaks(null, undefined, "body", "typescript", "python");
    expect(out.optionalVsNullDiffs).toHaveLength(1);
    expect(out.optionalVsNullDiffs[0]!.result.category).toBe("OPTIONAL_VS_NULL");
    expect(out.caseLeakDiffs).toHaveLength(0);
  });

  it("detects OPTIONAL_VS_NULL on nested nullable field", () => {
    const bodyA = { id: 1, notes: null };
    const bodyB = { id: 1 }; // notes omitted
    const out = scanBodyForNullAndCaseLeaks(bodyA, bodyB, "body", "typescript", "python");
    expect(out.optionalVsNullDiffs).toHaveLength(1);
    expect(out.optionalVsNullDiffs[0]!.path).toBe("body.notes");
    expect(out.optionalVsNullDiffs[0]!.result.category).toBe("OPTIONAL_VS_NULL");
  });

  it("detects OPTIONAL_VS_NULL when SDK B sends null and A omits", () => {
    const bodyA = { id: 1 };
    const bodyB = { id: 1, tag: null };
    const out = scanBodyForNullAndCaseLeaks(bodyA, bodyB, "body", "typescript", "python");
    expect(out.optionalVsNullDiffs).toHaveLength(1);
    expect(out.optionalVsNullDiffs[0]!.path).toBe("body.tag");
  });

  it("detects CASE_CONVENTION_LEAK when key casing differs between SDKs", () => {
    const bodyA = { petName: "Fido", status: "available" };
    const bodyB = { pet_name: "Fido", status: "available" };
    const out = scanBodyForNullAndCaseLeaks(bodyA, bodyB, "body", "typescript", "python");
    expect(out.caseLeakDiffs.length).toBeGreaterThan(0);
    expect(out.caseLeakDiffs[0]!.result.category).toBe("CASE_CONVENTION_LEAK");
    expect(out.caseLeakDiffs[0]!.result.message).toContain("petName");
    expect(out.caseLeakDiffs[0]!.result.message).toContain("pet_name");
  });

  it("detects CASE_CONVENTION_LEAK on createdAt vs created_at", () => {
    const bodyA = { id: 1, createdAt: "2024-01-01T00:00:00Z" };
    const bodyB = { id: 1, created_at: "2024-01-01T00:00:00Z" };
    const out = scanBodyForNullAndCaseLeaks(bodyA, bodyB, "body", "typescript", "python");
    expect(out.caseLeakDiffs.length).toBeGreaterThan(0);
    expect(out.caseLeakDiffs[0]!.result.category).toBe("CASE_CONVENTION_LEAK");
  });

  it("detects multiple divergences in the same object", () => {
    const bodyA = { petName: "Fido", notes: null, status: "available" };
    const bodyB = { pet_name: "Fido", status: "available" }; // notes omitted + key casing different
    const out = scanBodyForNullAndCaseLeaks(bodyA, bodyB, "body", "typescript", "python");
    expect(out.optionalVsNullDiffs.length + out.caseLeakDiffs.length).toBeGreaterThan(1);
  });

  it("scans nested objects recursively", () => {
    const bodyA = { user: { petName: "Fido" } };
    const bodyB = { user: { pet_name: "Fido" } };
    const out = scanBodyForNullAndCaseLeaks(bodyA, bodyB, "body", "typescript", "python");
    expect(out.caseLeakDiffs.length).toBeGreaterThan(0);
    expect(out.caseLeakDiffs[0]!.path).toContain("user");
  });

  it("scans array elements", () => {
    const bodyA = [{ tag: null }, { tag: "fluffy" }];
    const bodyB = [{ }, { tag: "fluffy" }];
    const out = scanBodyForNullAndCaseLeaks(bodyA, bodyB, "body", "typescript", "python");
    expect(out.optionalVsNullDiffs.length).toBeGreaterThan(0);
    expect(out.optionalVsNullDiffs[0]!.path).toContain("[0]");
  });

  it("returns no divergences for identical bodies", () => {
    const body = { id: 1, name: "Fido", status: "available" };
    const out = scanBodyForNullAndCaseLeaks(body, body, "body", "typescript", "python");
    expect(out.optionalVsNullDiffs).toHaveLength(0);
    expect(out.caseLeakDiffs).toHaveLength(0);
  });

  it("returns no divergences for two empty objects", () => {
    const out = scanBodyForNullAndCaseLeaks({}, {}, "body", "typescript", "python");
    expect(out.optionalVsNullDiffs).toHaveLength(0);
    expect(out.caseLeakDiffs).toHaveLength(0);
  });
});
