import { describe, expect, it, vi } from "vitest";
import { runCLI } from "../src/index.js";

describe("WireParity CLI", () => {
  it("displays help and exits with code 0 on --help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitCode = await runCLI(["--help"]);
    expect(exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    logSpy.mockRestore();
  });

  it("returns exit code 2 when missing required arguments", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitCode = await runCLI([]);
    expect(exitCode).toBe(2);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Missing required argument"));
    errSpy.mockRestore();
  });
});
