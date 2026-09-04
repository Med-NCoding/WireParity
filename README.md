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

### 4. Runner Protocol & Custom Adapters

> [!IMPORTANT]
> **Example Runners Scope**: The included example runners in `examples/runners/` (TypeScript, Python, and Go) are minimal demonstration adapters specific to `examples/spec.yaml` (handling `listPets`, `createPet`, and `getPetById`).
>
> When testing your own **external APIs**, you must create custom runner adapters that map your API spec's `operationId`s to calls into your actual generated SDKs. If a runner encounters an unsupported `operationId`, returns `{"success": false}`, exits unexpectedly, or fails to capture an HTTP request, WireParity marks the operation as an execution error and will **never** report parity success.

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
2. **Execution**: The runner translates WireParity IR values to native SDK types and invokes the target SDK method directed at `targetUrl`.
3. **Output (`stdout`)**: The runner writes one JSON line before exiting:
   ```json
   { "success": true }
   ```
   Or on error / unsupported operation:
   ```json
   { "success": false, "error": "Unsupported operation: myCustomOp" }
   ```

Minimal runnable implementations specific to `examples/spec.yaml` are provided in:
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
