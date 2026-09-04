# WireParity

Differential testing tool for multi-language API SDKs.

## Overview

WireParity verifies that SDKs generated across different programming languages (TypeScript, Python, Go, etc.) emit semantically equivalent HTTP wire requests for identical logical inputs.

## Quick Start & End-to-End Example

WireParity includes runnable runner examples in `examples/runners/` for TypeScript, Python, and Go, paired with an OpenAPI specification in `examples/spec.yaml`.

### 1. Installation & Build

```bash
pnpm install
pnpm build
```

### 2. Run with Configuration File

Run differential parity testing against the example spec and runners using `examples/wireparity.config.json`:

```bash
pnpm wireparity --config examples/wireparity.config.json
```

Or invoke the CLI directly with Node:

```bash
node dist/cli/bin.js --config examples/wireparity.config.json
```

### 3. Run with CLI Flags

You can also specify the specification and runner commands directly via CLI flags:

```bash
pnpm wireparity --spec examples/spec.yaml \
  --ts "node examples/runners/typescript/runner.ts" \
  --py "python3 examples/runners/python/runner.py"
```

If Go is installed on your system, you can also include the Go runner:

```bash
pnpm wireparity --spec examples/spec.yaml \
  --ts "node examples/runners/typescript/runner.ts" \
  --py "python3 examples/runners/python/runner.py" \
  --go "go run examples/runners/go/main.go"
```

### 4. Runner Protocol

External runners communicate with WireParity over standard input and standard output using a single-line JSON IPC protocol:

1. **Input (`stdin`)**: WireParity writes one JSON line containing the operation and inputs:
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
2. **Execution**: The runner invokes the target SDK / HTTP client directed at `targetUrl`.
3. **Output (`stdout`)**: The runner writes one JSON line before exiting:
   ```json
   { "success": true }
   ```

Minimal runnable implementations are provided in:
- `examples/runners/typescript/runner.ts`
- `examples/runners/python/runner.py`
- `examples/runners/go/main.go`

## Development

```bash
# Run type checks
pnpm typecheck

# Run test suite
pnpm test
```
