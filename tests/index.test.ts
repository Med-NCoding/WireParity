import { describe, expect, it } from "vitest";
import { APP_NAME, getVersion } from "../src/index.js";

describe("wireparity bootstrap", () => {
  it("exports application metadata", () => {
    expect(APP_NAME).toBe("wireparity");
    expect(getVersion()).toBe("0.1.0");
  });
});
