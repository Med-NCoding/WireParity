/**
 * Tests for Step 3.1: Subprocess IPC Protocol Framing
 *
 * Uses a real Node.js child process to verify the full JSON-lines IPC
 * protocol end-to-end: orchestrator → stdin → subprocess → stdout →
 * orchestrator.
 *
 * The test subprocess is spawned inline as a node -e script so no extra
 * fixture files are needed.
 *
 * Covers:
 * 1. encodeIPCRequest / decodeIPCResponse round-trip (unit)
 * 2. Successful subprocess IPC: request received, response parsed
 * 3. IPCResponse `capturedRequest` field is propagated
 * 4. Failure subprocess: success=false and error surfaced
 * 5. Non-JSON stdout: decodeIPCResponse error surfaced in RunnerResult
 * 6. Timeout: process killed after timeoutMs and failure returned
 * 7. Spawn error: non-existent binary returns failure
 */

import { describe, it, expect } from "vitest";
import {
  encodeIPCRequest,
  decodeIPCResponse,
  type IPCRequest,
} from "../src/runners/types.js";
import { SubprocessSDKRunner } from "../src/runners/subprocess.js";
import { createOperationInputs } from "../src/ir/inputs.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal IPCRequest for test use. */
function makeReq(overrides: Partial<IPCRequest> = {}): IPCRequest {
  return {
    operationId: "testOp",
    inputs: createOperationInputs(),
    targetUrl: "http://localhost:9000",
    ...overrides,
  };
}

/** Node script template: reads one JSON line from stdin, acts on it, writes one JSON line to stdout. */
function nodeScript(body: string): string {
  return [
    `let buf = "";`,
    `process.stdin.setEncoding("utf-8");`,
    `process.stdin.on("data", d => { buf += d; });`,
    `process.stdin.on("end", () => {`,
    `  const req = JSON.parse(buf.trim());`,
    body,
    `});`,
  ].join("\n");
}

/** Spawns a node -e script runner. */
function makeRunner(script: string, timeoutMs = 5000): SubprocessSDKRunner {
  return new SubprocessSDKRunner("mock", {
    command: process.execPath, // current node binary
    args: ["-e", script],
    timeoutMs,
  });
}

// ---------------------------------------------------------------------------
// 1. encodeIPCRequest / decodeIPCResponse unit round-trip
// ---------------------------------------------------------------------------

describe("encodeIPCRequest / decodeIPCResponse round-trip", () => {
  it("encodes a request to a single JSON string", () => {
    const req = makeReq();
    const encoded = encodeIPCRequest(req);
    expect(typeof encoded).toBe("string");
    expect(encoded.includes("\n")).toBe(false);
    const parsed = JSON.parse(encoded);
    expect(parsed.operationId).toBe("testOp");
    expect(parsed.targetUrl).toBe("http://localhost:9000");
  });

  it("decodeIPCResponse parses a valid success response", () => {
    const line = JSON.stringify({ success: true });
    const res = decodeIPCResponse(line);
    expect(res.success).toBe(true);
  });

  it("decodeIPCResponse parses a failure response with error", () => {
    const line = JSON.stringify({ success: false, error: "sdk boom" });
    const res = decodeIPCResponse(line);
    expect(res.success).toBe(false);
    expect(res.error).toBe("sdk boom");
  });

  it("decodeIPCResponse parses a response with capturedRequest", () => {
    const cr = { method: "POST", url: "http://localhost:9000/pets", headers: { "content-type": "application/json" } };
    const line = JSON.stringify({ success: true, capturedRequest: cr });
    const res = decodeIPCResponse(line);
    expect(res.success).toBe(true);
    expect(res.capturedRequest?.method).toBe("POST");
    expect(res.capturedRequest?.url).toBe("http://localhost:9000/pets");
  });

  it("decodeIPCResponse throws on invalid JSON", () => {
    expect(() => decodeIPCResponse("not json")).toThrow("IPCResponse parse error");
  });

  it("decodeIPCResponse throws when 'success' field is missing", () => {
    expect(() => decodeIPCResponse(JSON.stringify({ error: "x" }))).toThrow(
      "IPCResponse parse error"
    );
  });

  it("decodeIPCResponse throws when 'success' is not a boolean", () => {
    expect(() => decodeIPCResponse(JSON.stringify({ success: "yes" }))).toThrow(
      "IPCResponse parse error"
    );
  });

  it("decodeIPCResponse tolerates leading/trailing whitespace", () => {
    const line = "  " + JSON.stringify({ success: true }) + "  \n";
    expect(() => decodeIPCResponse(line)).not.toThrow();
    expect(decodeIPCResponse(line).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Successful subprocess IPC round-trip
// ---------------------------------------------------------------------------

describe("SubprocessSDKRunner – successful IPC round-trip", () => {
  it("sends IPCRequest on stdin and parses IPCResponse from stdout", async () => {
    const script = nodeScript(
      `  const resp = { success: true };\n  process.stdout.write(JSON.stringify(resp) + "\\n");`
    );
    const runner = makeRunner(script);
    const result = await runner.sendRequest(makeReq());

    expect(result.success).toBe(true);
    expect(result.language).toBe("mock");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.ipcResponse?.success).toBe(true);
  });

  it("subprocess receives the operationId from the IPC request", async () => {
    const script = nodeScript(
      `  const ok = req.operationId === "listPets";\n` +
      `  process.stdout.write(JSON.stringify({ success: ok, error: ok ? undefined : "wrong opId: " + req.operationId }) + "\\n");`
    );
    const runner = makeRunner(script);
    const result = await runner.sendRequest(makeReq({ operationId: "listPets" }));
    expect(result.success).toBe(true);
  });

  it("subprocess receives the targetUrl from the IPC request", async () => {
    const script = nodeScript(
      `  const ok = req.targetUrl === "http://capture:9999";\n` +
      `  process.stdout.write(JSON.stringify({ success: ok }) + "\\n");`
    );
    const runner = makeRunner(script);
    const result = await runner.sendRequest(makeReq({ targetUrl: "http://capture:9999" }));
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. capturedRequest propagation
// ---------------------------------------------------------------------------

describe("SubprocessSDKRunner – capturedRequest propagation", () => {
  it("propagates capturedRequest from IPCResponse into RunnerResult.ipcResponse", async () => {
    const cr = {
      method: "GET",
      url: "http://localhost:9000/pets",
      headers: { "x-api-key": "test" },
    };
    const script = nodeScript(
      `  const resp = { success: true, capturedRequest: ${JSON.stringify(cr)} };\n` +
      `  process.stdout.write(JSON.stringify(resp) + "\\n");`
    );
    const runner = makeRunner(script);
    const result = await runner.sendRequest(makeReq());

    expect(result.success).toBe(true);
    expect(result.ipcResponse?.capturedRequest?.method).toBe("GET");
    expect(result.ipcResponse?.capturedRequest?.url).toBe("http://localhost:9000/pets");
    expect(result.ipcResponse?.capturedRequest?.headers?.["x-api-key"]).toBe("test");
  });
});

// ---------------------------------------------------------------------------
// 4. Failure subprocess
// ---------------------------------------------------------------------------

describe("SubprocessSDKRunner – failure subprocess", () => {
  it("returns success=false and error from IPCResponse when subprocess reports failure", async () => {
    const script = nodeScript(
      `  process.stdout.write(JSON.stringify({ success: false, error: "sdk call failed" }) + "\\n");`
    );
    const runner = makeRunner(script);
    const result = await runner.sendRequest(makeReq());

    expect(result.success).toBe(false);
    expect(result.error).toBe("sdk call failed");
    expect(result.ipcResponse?.success).toBe(false);
  });

  it("returns success=false when subprocess exits non-zero with no stdout", async () => {
    const script = `process.stderr.write("boom\\n"); process.exit(1);`;
    const runner = makeRunner(script);
    const result = await runner.sendRequest(makeReq());

    expect(result.success).toBe(false);
    expect(result.error).toContain("boom");
  });
});

// ---------------------------------------------------------------------------
// 5. Non-JSON stdout → decodeIPCResponse error surfaced
// ---------------------------------------------------------------------------

describe("SubprocessSDKRunner – non-JSON stdout", () => {
  it("surfaces a parse error in RunnerResult when subprocess emits non-JSON stdout", async () => {
    const script = nodeScript(`  process.stdout.write("not json\\n");`);
    const runner = makeRunner(script);
    const result = await runner.sendRequest(makeReq());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/IPCResponse parse error/);
  });
});

// ---------------------------------------------------------------------------
// 6. Timeout
// ---------------------------------------------------------------------------

describe("SubprocessSDKRunner – timeout", () => {
  it("kills the subprocess and returns success=false after timeoutMs", async () => {
    const script = `setTimeout(() => {}, 60000);`; // hangs forever
    const runner = makeRunner(script, 200);
    const result = await runner.sendRequest(makeReq());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/i);
    expect(result.durationMs).toBeGreaterThanOrEqual(200);
  }, 5000);
});

// ---------------------------------------------------------------------------
// 7. Spawn error
// ---------------------------------------------------------------------------

describe("SubprocessSDKRunner – spawn error", () => {
  it("returns success=false with an error message when binary does not exist", async () => {
    const runner = new SubprocessSDKRunner("mock", {
      command: "/nonexistent/binary/that/does/not/exist",
      timeoutMs: 3000,
    });
    const result = await runner.sendRequest(makeReq());

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
