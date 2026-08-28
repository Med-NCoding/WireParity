/**
 * WireParity - Step 7.3: Date/Time Format & Enum Value Classifier Tests
 */

import { describe, it, expect } from "vitest";
import {
  isIso8601String,
  isDateOnlyString,
  isRfc1123DateString,
  isUnixTimestampNumber,
  classifyDateTimeDivergence,
  classifyEnumDivergence,
  scanBodyForDateTimeAndEnumDivergences,
} from "../src/comparator/classifiers/datetime_and_enum.js";
import { classifyDivergence } from "../src/comparator/classifier.js";

// ─── Date / Time Helper Tests ─────────────────────────────────────────────────

describe("Date / Time Helper Functions", () => {
  it("isIso8601String validates ISO-8601 datetime strings", () => {
    expect(isIso8601String("2024-01-15T12:30:00Z")).toBe(true);
    expect(isIso8601String("2024-01-15T12:30:00.000Z")).toBe(true);
    expect(isIso8601String("2024-01-15T12:30:00+02:00")).toBe(true);
    expect(isIso8601String("2024-01-15T12:30:00-05:00")).toBe(true);

    expect(isIso8601String("2024-01-15")).toBe(false);
    expect(isIso8601String("not-a-date")).toBe(false);
    expect(isIso8601String(1705321800)).toBe(false);
  });

  it("isDateOnlyString validates YYYY-MM-DD date strings", () => {
    expect(isDateOnlyString("2024-01-15")).toBe(true);
    expect(isDateOnlyString("1999-12-31")).toBe(true);

    expect(isDateOnlyString("2024-01-15T00:00:00Z")).toBe(false);
    expect(isDateOnlyString("01/15/2024")).toBe(false);
    expect(isDateOnlyString("")).toBe(false);
  });

  it("isRfc1123DateString validates HTTP date strings", () => {
    expect(isRfc1123DateString("Mon, 15 Jan 2024 12:30:00 GMT")).toBe(true);
    expect(isRfc1123DateString("2024-01-15T12:30:00Z")).toBe(false);
  });

  it("isUnixTimestampNumber validates integer timestamps", () => {
    expect(isUnixTimestampNumber(1705321800)).toBe(true); // seconds
    expect(isUnixTimestampNumber(1705321800000)).toBe(true); // milliseconds
    expect(isUnixTimestampNumber(0)).toBe(true);

    expect(isUnixTimestampNumber(1705321800.5)).toBe(false);
    expect(isUnixTimestampNumber(NaN)).toBe(false);
    expect(isUnixTimestampNumber(Infinity)).toBe(false);
    expect(isUnixTimestampNumber("1705321800")).toBe(false);
  });
});

// ─── classifyDateTimeDivergence Tests ─────────────────────────────────────────

describe("classifyDateTimeDivergence", () => {
  it("detects ISO-8601 string vs Unix epoch seconds number", () => {
    const res = classifyDateTimeDivergence("createdAt", "2024-01-15T12:00:00Z", 1705320000, "TS", "Python");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("DATETIME_FORMAT_MISMATCH");
    expect(res!.severity).toBe("critical");
    expect(res!.message).toContain("createdAt");
    expect(res!.message).toContain("seconds");
    expect(res!.message).toContain("TS");
    expect(res!.message).toContain("Python");
  });

  it("detects Unix epoch number vs ISO-8601 string in reverse", () => {
    const res = classifyDateTimeDivergence("updatedAt", 1705320000000, "2024-01-15T12:00:00.000Z", "TS", "Python");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("DATETIME_FORMAT_MISMATCH");
    expect(res!.severity).toBe("critical");
    expect(res!.message).toContain("milliseconds");
  });

  it("detects Date-only string vs Unix epoch number", () => {
    const res = classifyDateTimeDivergence("shipDate", "2024-01-15", 1705276800);
    expect(res).not.toBeNull();
    expect(res!.category).toBe("DATETIME_FORMAT_MISMATCH");
    expect(res!.message).toContain("Date string vs Unix epoch number");
  });

  it("detects numeric string epoch vs ISO-8601 string", () => {
    const res = classifyDateTimeDivergence("placedAt", "1705320000", "2024-01-15T12:00:00Z");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("DATETIME_FORMAT_MISMATCH");
    expect(res!.message).toContain("numeric epoch string");
  });

  it("detects date-only vs full date-time truncation", () => {
    const res = classifyDateTimeDivergence("eventDate", "2024-01-15", "2024-01-15T00:00:00Z");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("DATETIME_FORMAT_MISMATCH");
    expect(res!.severity).toBe("warning");
    expect(res!.message).toContain("precision truncation");
  });

  it("detects RFC-1123 vs ISO-8601 string", () => {
    const res = classifyDateTimeDivergence("headerDate", "Mon, 15 Jan 2024 12:30:00 GMT", "2024-01-15T12:30:00Z");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("DATETIME_FORMAT_MISMATCH");
    expect(res!.message).toContain("RFC-1123");
  });

  it("detects ISO-8601 formatting variation for identical instant (.000Z vs Z)", () => {
    const res = classifyDateTimeDivergence("timestamp", "2024-01-15T12:00:00.000Z", "2024-01-15T12:00:00Z");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("DATETIME_FORMAT_MISMATCH");
    expect(res!.severity).toBe("warning");
    expect(res!.message).toContain("ISO-8601 formatting variation");
  });

  it("detects ISO-8601 formatting variation for UTC offset (+00:00 vs Z)", () => {
    const res = classifyDateTimeDivergence("timestamp", "2024-01-15T12:00:00+00:00", "2024-01-15T12:00:00Z");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("DATETIME_FORMAT_MISMATCH");
    expect(res!.severity).toBe("warning");
  });

  it("detects different timestamps as DATETIME_FORMAT_MISMATCH", () => {
    const res = classifyDateTimeDivergence("timestamp", "2024-01-15T12:00:00Z", "2024-02-20T18:00:00Z");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("DATETIME_FORMAT_MISMATCH");
    expect(res!.severity).toBe("critical");
  });

  it("detects numeric timestamp unit mismatch (seconds vs millis)", () => {
    const res = classifyDateTimeDivergence("epochTime", 1705320000, 1705320000000, "TS", "Go");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("DATETIME_FORMAT_MISMATCH");
    expect(res!.message).toContain("unit mismatch");
  });

  it("returns null for identical date values", () => {
    expect(classifyDateTimeDivergence("createdAt", "2024-01-15T12:00:00Z", "2024-01-15T12:00:00Z")).toBeNull();
    expect(classifyDateTimeDivergence("epoch", 1705320000, 1705320000)).toBeNull();
  });

  it("returns null for non-date strings or null/undefined", () => {
    expect(classifyDateTimeDivergence("name", "hello", "world")).toBeNull();
    expect(classifyDateTimeDivergence("val", undefined, "2024-01-15T12:00:00Z")).toBeNull();
  });
});

// ─── classifyEnumDivergence Tests ─────────────────────────────────────────────

describe("classifyEnumDivergence", () => {
  it("detects ordinal integer vs string enum name", () => {
    const res = classifyEnumDivergence("status", 0, "available", ["available", "pending", "sold"], "Go", "TS");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("ENUM_SERIALIZATION_ERROR");
    expect(res!.severity).toBe("critical");
    expect(res!.message).toContain("status");
    expect(res!.message).toContain("ordinal index 0 maps to declared variant 'available'");
    expect(res!.message).toContain("Go");
    expect(res!.message).toContain("TS");
  });

  it("detects string enum name vs ordinal integer in reverse", () => {
    const res = classifyEnumDivergence("status", "pending", 1, ["available", "pending", "sold"]);
    expect(res).not.toBeNull();
    expect(res!.category).toBe("ENUM_SERIALIZATION_ERROR");
    expect(res!.message).toContain("ordinal index 1 maps to declared variant 'pending'");
  });

  it("detects string numeric ordinal vs string enum name", () => {
    const res = classifyEnumDivergence("orderStatus", "0", "placed");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("ENUM_SERIALIZATION_ERROR");
    expect(res!.message).toContain("ordinal string");
  });

  it("detects enum variant casing divergence (uppercase vs lowercase)", () => {
    const res = classifyEnumDivergence("status", "PLACED", "placed");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("ENUM_SERIALIZATION_ERROR");
    expect(res!.message).toContain("casing divergence");
    expect(res!.message).toContain("PLACED");
    expect(res!.message).toContain("placed");
  });

  it("detects enum variant casing divergence (TitleCase vs lowercase)", () => {
    const res = classifyEnumDivergence("status", "Available", "available");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("ENUM_SERIALIZATION_ERROR");
    expect(res!.message).toContain("casing divergence");
  });

  it("detects type-prefixed enum variant names", () => {
    const res = classifyEnumDivergence("status", "PetStatusAvailable", "available");
    expect(res).not.toBeNull();
    expect(res!.category).toBe("ENUM_SERIALIZATION_ERROR");
    expect(res!.message).toContain("type-prefixed");
  });

  it("returns null for identical enum values", () => {
    expect(classifyEnumDivergence("status", "available", "available")).toBeNull();
    expect(classifyEnumDivergence("status", 1, 1)).toBeNull();
  });

  it("returns null for non-enum string differences", () => {
    expect(classifyEnumDivergence("description", "A friendly golden retriever", "A cute kitten")).toBeNull();
  });
});

// ─── scanBodyForDateTimeAndEnumDivergences Tests ──────────────────────────────

describe("scanBodyForDateTimeAndEnumDivergences", () => {
  it("scans and detects both datetime and enum divergences in nested object", () => {
    const bodyA = {
      id: "123",
      status: "PLACED",
      createdAt: "2024-01-15T12:00:00Z",
      nested: {
        orderDate: 1705320000,
        subStatus: 0,
      },
    };
    const bodyB = {
      id: "123",
      status: "placed",
      createdAt: 1705320000,
      nested: {
        orderDate: "2024-01-15T12:00:00Z",
        subStatus: "active",
      },
    };

    const out = scanBodyForDateTimeAndEnumDivergences(bodyA, bodyB, "body", "TS", "Python");
    expect(out.dateTimeDiffs).toHaveLength(2); // createdAt and nested.orderDate
    expect(out.enumDiffs).toHaveLength(2); // status and nested.subStatus
  });

  it("scans arrays for datetime and enum divergences", () => {
    const bodyA = [
      { timestamp: "2024-01-15T12:00:00Z", status: "AVAILABLE" },
    ];
    const bodyB = [
      { timestamp: 1705320000, status: "available" },
    ];

    const out = scanBodyForDateTimeAndEnumDivergences(bodyA, bodyB);
    expect(out.dateTimeDiffs).toHaveLength(1);
    expect(out.dateTimeDiffs[0]!.path).toBe("body[0].timestamp");
    expect(out.enumDiffs).toHaveLength(1);
    expect(out.enumDiffs[0]!.path).toBe("body[0].status");
  });

  it("returns empty arrays for identical payloads", () => {
    const body = { id: 1, status: "active", date: "2024-01-15T00:00:00Z" };
    const out = scanBodyForDateTimeAndEnumDivergences(body, body);
    expect(out.dateTimeDiffs).toHaveLength(0);
    expect(out.enumDiffs).toHaveLength(0);
  });
});

// ─── classifyDivergence Integration Tests ─────────────────────────────────────

describe("classifyDivergence integration with Step 7.3", () => {
  it("classifies ISO string vs epoch number as DATETIME_FORMAT_MISMATCH in body", () => {
    const diff = classifyDivergence("body", "body.createdAt", "2024-01-15T12:00:00Z", 1705320000);
    expect(diff.category).toBe("DATETIME_FORMAT_MISMATCH");
  });

  it("classifies enum casing as ENUM_SERIALIZATION_ERROR in body", () => {
    const diff = classifyDivergence("body", "body.status", "PLACED", "placed");
    expect(diff.category).toBe("ENUM_SERIALIZATION_ERROR");
  });

  it("classifies ordinal index vs enum string as ENUM_SERIALIZATION_ERROR in body", () => {
    const diff = classifyDivergence("body", "body.status", 0, "available");
    expect(diff.category).toBe("ENUM_SERIALIZATION_ERROR");
  });
});
