# WireParity

Differential testing tool for multi-language API SDKs.

## Overview

WireParity verifies that SDKs generated across different programming languages (TypeScript, Python, Go, etc.) from the same OpenAPI specification emit semantically equivalent HTTP wire requests for identical logical inputs.

WireParity uses property-based testing to synthesize inputs, dispatches them to language runner adapters, captures outbound HTTP requests, normalizes non-semantic transport differences, and reports wire divergences.

## Requirements

- Node.js `>=18.3.0`

## Architecture

```
OpenAPI Spec
     │
     ▼
Property-Based Input Generator
     │
     ▼
SDK Runners (JSON IPC via stdin/stdout)
     │
     ▼
HTTP Capture Server
     │
     ▼
Request Normalization
     │
     ▼
Semantic Comparison & Shrinking
     │
     ▼
Parity Report
```

---

## Quick Start

### 1. Installation

```bash
npm install --save-dev wireparity
```

### 2. Run with CLI Flags

Point WireParity at your OpenAPI 3.0/3.1 spec and runner commands:

```bash
npx wireparity --spec ./openapi.yaml \
  --ts "node ./runners/ts_runner.js" \
  --py "python3 ./runners/py_runner.py"
```

Include `--go` if testing a Go SDK:

```bash
npx wireparity --spec ./openapi.yaml \
  --ts "node ./runners/ts_runner.js" \
  --py "python3 ./runners/py_runner.py" \
  --go "go run ./runners/go/main.go"
```

### 3. Run with Configuration File

Create `wireparity.config.json` in your project root:

```json
{
  "spec": "./openapi.yaml",
  "runners": {
    "typescript": "node ./runners/ts_runner.js",
    "python": "python3 ./runners/py_runner.py",
    "go": "go run ./runners/go/main.go"
  },
  "options": {
    "iterations": 5
  }
}
```

Run without flags:

```bash
npx wireparity
```

### CLI Options

| Flag | Description | Default |
|---|---|---|
| `-s, --spec <path>` | Path to OpenAPI spec (`.json`, `.yaml`, `.yml`) | From config |
| `-c, --config <path>` | Path to config file | `wireparity.config.json` |
| `--ts <command>` | TypeScript runner command | — |
| `--py <command>` | Python runner command | — |
| `--go <command>` | Go runner command | — |
| `-n, --iterations <num>` | Test iterations per operation | `5` |
| `-o, --operations <list>` | Comma-separated operation IDs to test | All |
| `-b, --bail` | Stop on first divergent operation | `false` |
| `--seed <seed>` | Deterministic PRNG seed | Generated |
| `--replay-path <path>` | Tree path for bug reproduction | — |
| `--json` | Output JSON report | `false` |
| `-h, --help` | Show help | — |
| `-v, --version` | Show version | — |

---

## Runner Protocol

Runners communicate with WireParity using a single-line JSON IPC protocol over `stdin` and `stdout`:

1. **Input (`stdin`)**: WireParity sends one JSON line per iteration:
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
2. **Execution**: The runner translates inputs to native SDK types and invokes the SDK method pointing at `targetUrl`.
3. **Output (`stdout`)**: The runner outputs one JSON line before exiting:
   ```json
   { "success": true }
   ```
   Or on failure / unsupported operation:
   ```json
   { "success": false, "error": "Unsupported operation: customOp" }
   ```

---

## Try the Included Examples

To run the included PetStore example in this repository:

```bash
pnpm install
pnpm build
pnpm wireparity --config examples/wireparity.config.json
```

Or via CLI flags:

```bash
pnpm wireparity --spec examples/spec.yaml \
  --ts "node examples/runners/typescript/runner.ts" \
  --py "python3 examples/runners/python/runner.py"
```

---

## Limitations

- **OpenAPI 3.0 and 3.1 only** (JSON/YAML). Swagger 2.0 is not supported.
- **Outbound HTTP requests only**: Tests wire request serialization (method, path, query, headers, body). Does not test client response deserialization.
- **REST / HTTP only**: Does not support gRPC, WebSockets, or GraphQL.
- **Custom runners required**: You provide the runner script that maps operation IDs to your generated SDK calls.

---

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

---

## License

MIT
