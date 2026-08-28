/**
 * WireParity - Step 10.2: Real-World External OpenAPI Spec Benchmark
 *
 * Executes WireParity differential parity testing across realistic external
 * OpenAPI specifications:
 *   1. GitHub REST API subset (/repos/{owner}/{repo}, issues, labels)
 *   2. Stripe API subset (/v1/customers, /v1/payment_intents)
 *
 * Verifies that OpenAPI parsing, IR generation, input synthesis, differential
 * comparison, and CLI reporting perform reliably on external real-world API schemas.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseOpenAPISpec } from "../src/openapi/parser.js";
import { MockSDKRunner } from "../src/runners/mock.js";
import { runParitySuite } from "../src/reporter/orchestrator.js";
import { formatTerminalReport } from "../src/reporter/terminal.js";
import { formatJsonReport } from "../src/reporter/json.js";
import { runCLI } from "../src/cli/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GITHUB_SPEC_PATH = path.resolve(ROOT, "fixtures/specs/realworld/github_subset.json");
const STRIPE_SPEC_PATH = path.resolve(ROOT, "fixtures/specs/realworld/stripe_subset.json");

describe("Real-World External OpenAPI Spec Benchmark (Step 10.2)", () => {
  // ─── 1. Specification Parsing & IR Benchmark ──────────────────────────────

  it("successfully parses GitHub and Stripe external OpenAPI specifications", () => {
    const githubRaw = JSON.parse(fs.readFileSync(GITHUB_SPEC_PATH, "utf-8"));
    const githubDoc = parseOpenAPISpec(githubRaw);

    expect(githubDoc.title).toBe("GitHub REST API Subset");
    expect(githubDoc.operations).toHaveLength(4);
    expect(githubDoc.operations.map((o) => o.id)).toEqual([
      "getRepo",
      "listRepoIssues",
      "createIssue",
      "updateIssue",
    ]);

    const stripeRaw = JSON.parse(fs.readFileSync(STRIPE_SPEC_PATH, "utf-8"));
    const stripeDoc = parseOpenAPISpec(stripeRaw);

    expect(stripeDoc.title).toBe("Stripe API Subset");
    expect(stripeDoc.operations).toHaveLength(4);
    expect(stripeDoc.operations.map((o) => o.id)).toEqual([
      "createCustomer",
      "retrieveCustomer",
      "deleteCustomer",
      "createPaymentIntent",
    ]);
  });

  // ─── 2. GitHub API Multi-Language Differential Suite ──────────────────────

  it("executes differential parity benchmark across 3 SDKs on GitHub API subset", async () => {
    const doc = parseOpenAPISpec(JSON.parse(fs.readFileSync(GITHUB_SPEC_PATH, "utf-8")));

    // TypeScript GitHub SDK Client Simulator
    const tsRunner = new MockSDKRunner("typescript", async (op, inputs, targetUrl) => {
      const url = new URL(`${targetUrl}${op.path}`);
      const headers: Record<string, string> = {
        Accept: (inputs["Accept"] as string) ?? "application/vnd.github+json",
      };

      if (op.method === "GET") {
        if (inputs["state"]) url.searchParams.set("state", String(inputs["state"]));
        if (inputs["sort"]) url.searchParams.set("sort", String(inputs["sort"]));
        if (inputs["per_page"]) url.searchParams.set("per_page", String(inputs["per_page"]));
        if (inputs["labels"] && Array.isArray(inputs["labels"])) {
          url.searchParams.set("labels", (inputs["labels"] as string[]).join(","));
        }
        await fetch(url.toString(), { method: "GET", headers });
      } else {
        headers["Content-Type"] = "application/json";
        await fetch(url.toString(), {
          method: op.method,
          headers,
          body: JSON.stringify(inputs["body"] ?? inputs),
        });
      }
    });

    // Python GitHub SDK Client Simulator
    const pyRunner = new MockSDKRunner("python", async (op, inputs, targetUrl) => {
      const url = new URL(`${targetUrl}${op.path}`);
      const headers: Record<string, string> = {
        Accept: (inputs["Accept"] as string) ?? "application/vnd.github+json",
      };

      if (op.method === "GET") {
        if (inputs["state"]) url.searchParams.set("state", String(inputs["state"]));
        if (inputs["sort"]) url.searchParams.set("sort", String(inputs["sort"]));
        if (inputs["per_page"]) url.searchParams.set("per_page", String(inputs["per_page"]));
        if (inputs["labels"] && Array.isArray(inputs["labels"])) {
          url.searchParams.set("labels", (inputs["labels"] as string[]).join(","));
        }
        await fetch(url.toString(), { method: "GET", headers });
      } else {
        headers["Content-Type"] = "application/json";
        await fetch(url.toString(), {
          method: op.method,
          headers,
          body: JSON.stringify(inputs["body"] ?? inputs),
        });
      }
    });

    // Go GitHub SDK Client Simulator
    const goRunner = new MockSDKRunner("go", async (op, inputs, targetUrl) => {
      const url = new URL(`${targetUrl}${op.path}`);
      const headers: Record<string, string> = {
        Accept: (inputs["Accept"] as string) ?? "application/vnd.github+json",
      };

      if (op.method === "GET") {
        if (inputs["state"]) url.searchParams.set("state", String(inputs["state"]));
        if (inputs["sort"]) url.searchParams.set("sort", String(inputs["sort"]));
        if (inputs["per_page"]) url.searchParams.set("per_page", String(inputs["per_page"]));
        if (inputs["labels"] && Array.isArray(inputs["labels"])) {
          url.searchParams.set("labels", (inputs["labels"] as string[]).join(","));
        }
        await fetch(url.toString(), { method: "GET", headers });
      } else {
        headers["Content-Type"] = "application/json";
        await fetch(url.toString(), {
          method: op.method,
          headers,
          body: JSON.stringify(inputs["body"] ?? inputs),
        });
      }
    });

    const report = await runParitySuite(doc, [tsRunner, pyRunner, goRunner], {
      seed: "github-benchmark-seed",
      iterationsPerOperation: 3,
    });

    expect(report.totalOperations).toBe(4);
    expect(report.passedOperations).toBe(4);
    expect(report.divergentOperations).toBe(0);

    const formatted = formatTerminalReport(report);
    expect(formatted).toContain("Status: SUCCESS (100% wire parity)");
    expect(formatted).toContain("Summary: 4/4 operations matched.");
  });

  // ─── 3. Stripe API Multi-Language Differential Suite ──────────────────────

  it("executes differential parity benchmark across 3 SDKs on Stripe API subset", async () => {
    const doc = parseOpenAPISpec(JSON.parse(fs.readFileSync(STRIPE_SPEC_PATH, "utf-8")));

    const tsRunner = new MockSDKRunner("typescript", async (op, inputs, targetUrl) => {
      const url = new URL(`${targetUrl}${op.path}`);
      if (op.method === "GET") {
        if (inputs["expand"] && Array.isArray(inputs["expand"])) {
          url.searchParams.set("expand", (inputs["expand"] as string[]).join(","));
        }
        await fetch(url.toString(), { method: "GET" });
      } else if (op.method === "DELETE") {
        await fetch(url.toString(), { method: "DELETE" });
      } else {
        await fetch(url.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(inputs["body"] ?? inputs),
        });
      }
    });

    const pyRunner = new MockSDKRunner("python", async (op, inputs, targetUrl) => {
      const url = new URL(`${targetUrl}${op.path}`);
      if (op.method === "GET") {
        if (inputs["expand"] && Array.isArray(inputs["expand"])) {
          url.searchParams.set("expand", (inputs["expand"] as string[]).join(","));
        }
        await fetch(url.toString(), { method: "GET" });
      } else if (op.method === "DELETE") {
        await fetch(url.toString(), { method: "DELETE" });
      } else {
        await fetch(url.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(inputs["body"] ?? inputs),
        });
      }
    });

    const goRunner = new MockSDKRunner("go", async (op, inputs, targetUrl) => {
      const url = new URL(`${targetUrl}${op.path}`);
      if (op.method === "GET") {
        if (inputs["expand"] && Array.isArray(inputs["expand"])) {
          url.searchParams.set("expand", (inputs["expand"] as string[]).join(","));
        }
        await fetch(url.toString(), { method: "GET" });
      } else if (op.method === "DELETE") {
        await fetch(url.toString(), { method: "DELETE" });
      } else {
        await fetch(url.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(inputs["body"] ?? inputs),
        });
      }
    });

    const report = await runParitySuite(doc, [tsRunner, pyRunner, goRunner], {
      seed: "stripe-benchmark-seed",
      iterationsPerOperation: 3,
    });

    expect(report.totalOperations).toBe(4);
    expect(report.passedOperations).toBe(4);
    expect(report.divergentOperations).toBe(0);

    const jsonReport = formatJsonReport(report);
    expect(jsonReport).toContain('"status": "passed"');
    expect(jsonReport).toContain('"passRate": 1');
  });
});
