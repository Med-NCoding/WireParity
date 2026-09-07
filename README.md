# WireParity

Differential testing tool for multi-language API SDKs.

## Overview

WireParity verifies that SDKs generated across different programming languages (TypeScript, Python, Go, etc.) from the same OpenAPI specification emit semantically equivalent HTTP wire requests for identical logical inputs.

Instead of writing manual cross-language test suites, WireParity uses property-based testing to synthesize boundary inputs, feeds them to language-specific runner adapters, intercepts outgoing HTTP traffic on a local capture server, normalizes non-semantic transport differences, and reports exact wire divergences with minimized counterexamples.

## Requirements

- **Node.js**: `>=18.3.0` (required for native `node:util` `parseArgs` and ESM support)
- **SDK Runtimes**: The runtime environments required by your target SDKs (e.g., Python 3.x, Go 1.2x, Node.js).

## Architecture Flow

```
OpenAPI 3.0 / 3.1 Spec
         │
         ▼
Internal Representation (IR)
         │
         ▼
Property-Based Input Generator (fast-check)
         │
         ▼
SDK Runners (JSON IPC via stdin / stdout)
         │
         ▼
HTTP Capture Server (Local sink intercepting requests)
         │
         ▼
Request Normalization (Strips transport noise, lowercases headers)
         │
         ▼
Semantic Comparison & Shrinking (Categorizes diffs & minimizes failing inputs)
         │
         ▼
Parity Report (Terminal / JSON output)
```

---

## Quick Start (npm Users)

### 1. Installation

Install WireParity as a development dependency in your project:

```bash
npm install --save-dev wireparity
```

You can also run it directly without installing via `npx wireparity`.

### 2. Run Against Your OpenAPI Spec and Runners

Point WireParity at your OpenAPI 3.0 or 3.1 specification (`.yaml` or `.json`) and specify the commands to launch your runner adapters:

```bash
npx wireparity --spec ./openapi.yaml \
  --ts "node ./runners/ts_runner.js" \
  --py "python3 ./runners/py_runner.py"
```

If you also have a Go runner:

```bash
npx wireparity --spec ./openapi.yaml \
  --ts "node ./runners/ts_runner.js" \
  --py "python3 ./runners/py_runner.py" \
  --go "go run ./runners/go/main.go"
```

### 3. Using a Configuration File

You can create a `wireparity.config.json` in your project root:

```json
{
  "spec": "./openapi.yaml",
  "runners": {
    "typescript": "node ./runners/ts_runner.js",
    "python": "python3 ./runners/py_runner.py",
    "go": "go run ./runners/go/main.go"
  },
  "options": {
    "iterations": 5,
    "bail": false
  }
}
```

Then simply execute:

```bash
npx wireparity
```

WireParity automatically discovers `wireparity.config.json` in the current working directory, or you can specify a custom path with `--config <path>`.

### Common CLI Options

| Flag | Description | Default |
|---|---|---|
| `-s, --spec <path>` | Path to OpenAPI 3.0/3.1 spec (`.json`, `.yaml`, `.yml`) | Discovered in config |
| `-c, --config <path>` | Path to `wireparity.config.json` | Auto-discovered |
| `--ts <command>` | TypeScript runner command | — |
| `--py <command>` | Python runner command | — |
| `--go <command>` | Go runner command | — |
| `-n, --iterations <num>` | Number of test iterations per operation | `5` |
| `-o, --operations <list>` | Comma-separated list of operation IDs to test | All operations |
| `-b, --bail` | Stop test execution on first divergent operation | `false` |
| `--seed <seed>` | Deterministic seed for reproducible property runs | Generated |
| `--replay-path <path>` | Deterministic tree path for single-shot bug reproduction | — |
| `--json` | Output machine-readable JSON report | `false` |
| `-h, --help` | Show CLI help manual | — |
| `-v, --version` | Show version | — |

---

## Runner Protocol & Custom Adapters

WireParity communicates with target language SDKs through lightweight runner adapters over standard input (`stdin`) and standard output (`stdout`) using a single-line JSON IPC protocol.

When testing your own APIs, create a small adapter script in each target language that implements this contract:

1. **Input (`stdin`)**: WireParity writes one JSON line per test iteration:
   ```json
   {
     "operationId": "createPet",
     "inputs": {
       "pathParams": {},
       "queryParams": {},
       "headerParams": {},
       "body": { "kind": "object", "fields": { "name": { "kind": "string", "value": "Fido" } } }
     },
     "targetUrl": "http://127.0.0.1:9000"
   }
   ```
2. **Execution**: The adapter translates the IR inputs to native SDK types and invokes the target SDK method directed at `targetUrl`.
3. **Output (`stdout`)**: The adapter writes one JSON line before exiting:
   ```json
   { "success": true }
   ```
   Or on error / unsupported operation:
   ```json
   { "success": false, "error": "Unsupported operation: customOp" }
   ```

---

## Terminal Report Examples

### PASS Example
When all SDKs emit semantically equivalent HTTP wire requests across all iterations:

```text
[PASS] Operation: listPets (18ms)
  ✓ All SDKs produced semantically equivalent HTTP wire requests
```

### FAIL Example (Semantic Divergence)
When SDKs diverge, WireParity categorizes the divergence, displays the exact diff, provides replay parameters, and shrinks the input to a minimal counterexample:

```text
[FAIL] Operation: getPetById (42ms)
  Found 1 divergence(s):
  - [QUERY_PARAM_STYLE] /query/tags (severity: HIGH)
    Explanation: Query parameter array serialization differs
    typescript: "tags=cat,dog"
    python: "tags=cat&tags=dog"

  Replay Token: wp_c7f8a192b0c3
  Replay Path: 0:1:0:2 (Seed: 41829103)
  Replay CLI: wireparity --seed 41829103 --replay-path 0:1:0:2 --operations getPetById

  Minimal Reproducible Input (after 4 shrink steps):
  ```json
  {
    "pathParams": { "petId": "1" },
    "queryParams": { "tags": ["cat", "dog"] }
  }
  ```
```

### ERROR Example (Runner Execution Failure)
If an adapter crashes, exits non-zero, or returns `{"success": false}`, WireParity flags it as an execution error (preventing false-positive pass reports):

```text
[ERROR] Operation: getPetById (8ms)
  ✖ Execution error: Runner returned success=false: Unsupported operation: getPetById
```

---

## Try the Included Examples (Repository Clones)

If you have cloned the WireParity repository, runnable demonstration adapters and a sample OpenAPI spec are included in `examples/`:

- **OpenAPI Specification**: `examples/spec.yaml`
- **Runners**:
  - TypeScript: `examples/runners/typescript/runner.ts`
  - Python: `examples/runners/python/runner.py`
  - Go: `examples/runners/go/main.go`
- **Config File**: `examples/wireparity.config.json`

### Run with the Example Config

```bash
pnpm install
pnpm build
pnpm wireparity --config examples/wireparity.config.json
```

### Run with CLI Flags

```bash
pnpm wireparity --spec examples/spec.yaml \
  --ts "node examples/runners/typescript/runner.ts" \
  --py "python3 examples/runners/python/runner.py"
```

If Go is installed on your system:

```bash
pnpm wireparity --spec examples/spec.yaml \
  --ts "node examples/runners/typescript/runner.ts" \
  --py "python3 examples/runners/python/runner.py" \
  --go "go run examples/runners/go/main.go"
```

---

## Current Limitations

- **OpenAPI 3.0 and 3.1 Only**: Targets OpenAPI 3.0.x and 3.1.x specifications (`.yaml` or `.json`). Swagger 2.0 is not supported.
- **Outbound HTTP Request Parity**: Verifies serialization of outbound HTTP requests (method, path, query parameters, headers, and body). Does not evaluate response deserialization in SDK clients.
- **REST / HTTP Protocols**: Targets standard HTTP/1.1 REST APIs with JSON or URL-encoded payloads. Does not test gRPC, WebSockets, or GraphQL.
- **Runner Adapters Required**: WireParity does not automatically generate custom SDK adapter code for external APIs; users provide small runner scripts conforming to the single-line JSON IPC protocol.

---

## Development

```bash
# Install dependencies
pnpm install

# Build compiled output
pnpm build

# Run static type checks
pnpm typecheck

# Run complete test suite
pnpm test
```

---

## License

MIT
