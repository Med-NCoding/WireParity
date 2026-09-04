#!/usr/bin/env node
/**
 * Minimal external-user TypeScript SDK runner for WireParity.
 *
 * WireParity stdin/stdout IPC protocol:
 * 1. Reads a single JSON line from stdin:
 *    { "operationId": "...", "inputs": { ... }, "targetUrl": "..." }
 * 2. Translates WireParity IR values to native values and executes the HTTP call.
 * 3. Writes a single JSON line to stdout:
 *    { "success": true } or { "success": false, "error": "..." }
 */

// Helper to convert WireParity IR values to native JavaScript values
function irValueToJs(val: any): any {
  if (!val || typeof val !== "object") return val;
  if ("value" in val) return val.value;
  if (val.kind === "null") return null;
  if (val.kind === "array") return (val.items || []).map(irValueToJs);
  if (val.kind === "object") {
    const obj: Record<string, any> = {};
    for (const [k, v] of Object.entries(val.fields || {})) {
      obj[k] = irValueToJs(v);
    }
    return obj;
  }
  return val;
}

async function executeOperation(req: {
  operationId: string;
  inputs: any;
  targetUrl: string;
}): Promise<void> {
  const { operationId, inputs, targetUrl } = req;
  const baseUrl = targetUrl.replace(/\/+$/, "");

  switch (operationId) {
    case "listPets": {
      const limit = inputs.queryParams?.limit
        ? irValueToJs(inputs.queryParams.limit)
        : undefined;
      const url = new URL(`${baseUrl}/pets`);
      if (limit !== undefined) {
        url.searchParams.set("limit", String(limit));
      }
      await fetch(url.toString(), { method: "GET" });
      break;
    }

    case "createPet": {
      const body = inputs.body ? irValueToJs(inputs.body) : {};
      await fetch(`${baseUrl}/pets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      break;
    }

    case "getPetById": {
      const petId = inputs.pathParams?.petId
        ? irValueToJs(inputs.pathParams.petId)
        : "";
      await fetch(`${baseUrl}/pets/${encodeURIComponent(String(petId))}`, {
        method: "GET",
      });
      break;
    }

    default:
      throw new Error(`Unsupported operation: ${operationId}`);
  }
}

async function main(): Promise<void> {
  let buffer = "";
  process.stdin.setEncoding("utf-8");

  process.stdin.on("data", (chunk) => {
    buffer += chunk;
  });

  process.stdin.on("end", async () => {
    const line = buffer.trim();
    if (!line) {
      process.stdout.write(
        JSON.stringify({ success: false, error: "Empty input" }) + "\n"
      );
      process.exit(0);
    }

    try {
      const req = JSON.parse(line);
      await executeOperation(req);
      process.stdout.write(JSON.stringify({ success: true }) + "\n");
      process.exit(0);
    } catch (err: any) {
      process.stdout.write(
        JSON.stringify({
          success: false,
          error: err?.message || String(err),
        }) + "\n"
      );
      process.exit(0);
    }
  });
}

main();
