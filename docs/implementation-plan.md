# WireParity Architecture & Master Implementation Roadmap (Final)

## Core Architectural Principles & Decisions

1. **Toolchain & Commands**: Standardize on `pnpm` exclusively across all orchestration workflows (`pnpm typecheck`, `pnpm test`, `pnpm generate:sdks`).
2. **Pinned Reproducible OpenAPI Generation**: Use pinned `@openapitools/openapi-generator-cli` (v7.7.0 / generator runtime v7.7.0) with explicit declarative configuration files (`openapitools.json` and language config files in `fixtures/sdks/configs/`) to ensure deterministic, reproducible generation across TypeScript (`typescript-fetch` / `typescript-axios`), Python (`python` / `urllib3`), and Go (`go`).
3. **Language-Specific SDK Invocation Mapping behind Common Runner Interface**: Language runners encapsulate language-specific mapping logic (e.g. converting `operationId` + `OperationInputs` into TS positional/named object args, Python kwargs/models, Go struct pointers) behind a unified `SDKRunner` interface.
4. **Strict Normalization Scope (No Path Alteration & Strict Query Ordering)**:
   - **Path**: Path slashes (including duplicate slashes `//` or trailing slashes `/`) are **never normalized or stripped**; path formatting is part of the wire contract and differences must be reported as divergences.
   - **Query**: Repeated query parameter and array value ordering (`?tags=a&tags=b`) is **always preserved by default** unless the API contract explicitly defines that order is irrelevant (set semantics). `uniqueItems` does not imply unordered.
   - **Transport Headers**: Only strictly non-semantic transport noise (`User-Agent`, `Host`, `Connection`, `Content-Length`, `Accept-Encoding`) is filtered, and remaining header names are lowercased.
5. **Unified OpenAPI 3.0 Nullable & 3.1 Null Semantics in IR**:
   - The IR unifies OpenAPI 3.0 `nullable: true` and OpenAPI 3.1 `type: ["...", "null"]` into a single canonical `nullable: boolean` metadata flag across all schema definitions.
6. **`allOf` as Schema Intersection (Safe Documented Merge Subset)**:
   - `allOf` is treated as schema intersection. Merging is restricted to a safe, documented subset: object property union with conflicting type validation, required array union, and format intersection. Unresolvable conflicts emit clear validation errors.
7. **Deterministic `fast-check` Seed & Replay Path**:
   - Store both the root `seed` (e.g. integer/string) and the `path` (replay counterexample path from `fc.check`) in the parity report, guaranteeing 100% exact single-shot reproduction.
8. **JSON-Only Configuration**:
   - Configuration is strictly JSON-only (`wireparity.config.json`) for the initial version.
9. **Real-World Validation & Telemetry**:
   - Distinguish genuine divergences discovered in untouched real-world specs from synthetic injected regression test bugs in all metrics and reporting.

---

## High-Level Phase Overview

```
OpenAPI Spec (JSON / YAML)
           │
           ▼
[Phase 1] IR & Contract Modeling (Unified Nullable, Intersection allOf, OperationInputs)
           │
           ▼
[Phase 2] Pinned Generator Setup & TS/Python SDK Generation (openapitools.json)
           │
           ▼
[Phase 3] Language-Specific SDK Method Mapping behind Unified Runner Protocol
           │
           ▼
[Phase 4] Contract-Aware Normalization & Semantic Diff Engine (Strict Paths & Queries)
           │
           ▼
[Phase 5] Early End-to-End Vertical Slice (Real TS SDK vs Real Python SDK)
           │
           ▼
[Phase 6] Fast-Check Boundary Synthesis & Documented Regex Subset
           │
           ▼
[Phase 7] Divergence Classification & Seed/Path Replay Counterexample Shrinking
           │
           ▼
[Phase 8] Go SDK Generation, Runner & Three-Way Multi-Language Parity
           │
           ▼
[Phase 9] Developer CLI, JSON Config Loader & Multi-Format Reporting
           │
           ▼
[Phase 10] Real-World Validation, Genuine Divergence Metrics & CI Pipeline
```

---

## Detailed Step-by-Step Breakdown

---

### Phase 1: Intermediate Representation (IR) & Contract Modeling

#### Step 1.1: Operation & Parameter Style AST
- **Responsibility**: Define typed `IROperation`, parameter locations (`path`, `query`, `header`, `cookie`), serialization styles (`form`, `spaceDelimited`, `pipeDelimited`, `deepObject`), and `explode` booleans.
- **Target Files**: `src/ir/operations.ts`
- **Verification**: `pnpm typecheck`
- **Commit**: `define contract aware operation ast`

#### Step 1.2: Unified Nullable & Schema Constraint AST
- **Responsibility**: Define schema AST unifying OpenAPI 3.0 `nullable: true` and OpenAPI 3.1 `type: ["...", "null"]` into canonical `nullable: boolean`, with primitive formats (`date`, `date-time`, `uuid`, int32/int64/float), boundaries, and `uniqueItems`.
- **Target Files**: `src/ir/values.ts`
- **Verification**: `pnpm typecheck`
- **Commit**: `define schema constraint value ast`

#### Step 1.3: Structured Operation Inputs AST
- **Responsibility**: Define the `OperationInputs` model separating `pathParams`, `queryParams`, `headerParams`, and `body` to provide typed namespaces for language runners.
- **Target Files**: `src/ir/inputs.ts`, `src/ir/index.ts`
- **Verification**: Unit test checking `OperationInputs` creation in `tests/ir.test.ts`
- **Commit**: `add structured operation inputs model`

---

### Phase 2: OpenAPI Parser & Pinned SDK Generation Setup

#### Step 2.1: Spec Root Validation & Unified 3.0/3.1 Type Parsing
- **Responsibility**: Implement strict schema and root validation for OpenAPI 3.0.x and 3.1.x, parsing `type` arrays and `nullable` flags into unified IR schemas.
- **Target Files**: `src/openapi/parser.ts`
- **Verification**: Unit tests with 3.0 and 3.1 specs in `tests/openapi_parser.test.ts`
- **Commit**: `add openapi root spec validation`

#### Step 2.2: Local JSON Pointer $ref Resolver
- **Responsibility**: Resolve local JSON pointers (`#/components/...`) across schemas, parameters, and request bodies with circular reference detection.
- **Target Files**: `src/openapi/resolver.ts`
- **Verification**: Unit tests resolving deep and circular refs in `tests/openapi_resolver.test.ts`
- **Commit**: `implement json pointer ref resolver`

#### Step 2.3: Parameter & Path-Level Merging
- **Responsibility**: Parse operations, merge path-level parameters with operation-level overrides, and map parameter styles and explode defaults per OpenAPI spec.
- **Target Files**: `src/openapi/parser.ts`
- **Verification**: Unit tests verifying parameter style inheritance in `tests/openapi_parameters.test.ts`
- **Commit**: `parse openapi parameters and styles`

#### Step 2.4: Safe Documented allOf Schema Intersection
- **Responsibility**: Merge `allOf` schemas as strict schema intersection on documented safe subset (object property union, required arrays union, format intersection, emitting validation errors on conflicting types).
- **Target Files**: `src/openapi/parser.ts`
- **Verification**: Unit tests merging multi-level `allOf` schemas in `tests/openapi_schemas.test.ts`
- **Commit**: `merge schema allof compositions correctly`

#### Step 2.5: Schema Polymorphism oneOf & anyOf Fallback
- **Responsibility**: Parse `oneOf` and `anyOf` schema variants safely into fallback representations with warning telemetry.
- **Target Files**: `src/openapi/parser.ts`
- **Verification**: Unit tests for `oneOf`/`anyOf` in `tests/openapi_schemas.test.ts`
- **Commit**: `handle polymorphic schema variant definitions`

#### Step 2.6: PetStore Reference Spec & Generator Configs
- **Responsibility**: Create canonical OpenAPI 3.0.3 PetStore spec (`fixtures/specs/petstore.json`) and declarative generator configuration files (`fixtures/sdks/configs/openapitools.json`, `fixtures/sdks/configs/ts.json`, `fixtures/sdks/configs/python.json`) pinning OpenAPI Generator v7.7.0.
- **Target Files**: `fixtures/specs/petstore.json`, `fixtures/sdks/configs/`
- **Verification**: `tests/fixtures_spec.test.ts` validating spec against parser
- **Commit**: `create pinned openapi generator configs`

#### Step 2.7: Automated TS & Python SDK Generation
- **Responsibility**: Create automated pnpm script (`scripts/generate_sdks.sh`) generating untouched TypeScript (`fixtures/sdks/typescript/`) and Python (`fixtures/sdks/python/`) SDKs using the pinned generator config.
- **Target Files**: `scripts/generate_sdks.sh`, `package.json`
- **Verification**: Execute `pnpm generate:sdks` and verify generated packages exist
- **Commit**: `generate typescript and python sdks`

---

### Phase 3: Language-Specific SDK Method Mapping & Runner Protocol

#### Step 3.1: Subprocess IPC Protocol Framing
- **Responsibility**: Define standard JSON lines IPC protocol: send `{operationId, inputs: OperationInputs, targetUrl}` to child process stdin; parse child stdout status with timeout and error capture.
- **Target Files**: `src/runners/types.ts`, `src/runners/subprocess.ts`
- **Verification**: Unit test with a node subprocess in `tests/runners_ipc.test.ts`
- **Commit**: `implement subprocess runner ipc protocol`

#### Step 3.2: Language-Specific Invocation Mapping Model
- **Responsibility**: Define language-specific mapping interface behind common `SDKRunner` (TypeScript named/positional mapping, Python kwargs mapping, Go struct mapping).
- **Target Files**: `src/runners/mapping.ts`
- **Verification**: Unit test in `tests/runners_mapping.test.ts`
- **Commit**: `define sdk method invocation mapping`

#### Step 3.3: TypeScript SDK Runner Worker
- **Responsibility**: Create TypeScript runner worker (`fixtures/runners/ts_runner.ts`) that imports the generated TS SDK client, applies TS-specific method mapping, and invokes the generated SDK method.
- **Target Files**: `fixtures/runners/ts_runner.ts`
- **Verification**: Subprocess test calling generated TS SDK against `startCaptureServer` in `tests/ts_runner.test.ts`
- **Commit**: `implement typescript sdk runner worker`

#### Step 3.4: Python SDK Runner Worker
- **Responsibility**: Create Python runner worker (`fixtures/runners/py_runner.py`) that imports the generated Python SDK client, applies Python-specific method mapping, and invokes the generated SDK method.
- **Target Files**: `fixtures/runners/py_runner.py`
- **Verification**: Subprocess test calling generated Python SDK against `startCaptureServer` in `tests/py_runner.test.ts`
- **Commit**: `implement python sdk runner worker`

---

### Phase 4: Contract-Aware Normalization & Semantic Comparator

#### Step 4.1: Contract-Aware Header & Transport Normalizer
- **Responsibility**: Normalizer function accepting `(request, operation: IROperation)` that strips non-semantic headers (`user-agent`, `host`, `connection`, `content-length`, `accept-encoding`) and lowercases remaining header keys.
- **Target Files**: `src/normalization/headers.ts`
- **Verification**: Unit test in `tests/normalization_headers.test.ts`
- **Commit**: `add contract aware header normalizer`

#### Step 4.2: Strict Path & Contract-Aware Query Normalizer
- **Responsibility**: Normalizer function accepting `(request, operation: IROperation)` that strictly preserves path slashes (no duplicate or trailing slash removal) and strictly preserves repeated query parameter and array value ordering by default unless the API contract explicitly defines that order is irrelevant (set semantics; `uniqueItems` does not mean unordered).
- **Target Files**: `src/normalization/query_path.ts`
- **Verification**: Unit test verifying path preservation and query order preservation in `tests/normalization_query.test.ts`
- **Commit**: `add contract aware query normalizer`

#### Step 4.3: Canonical JSON Body Normalizer
- **Responsibility**: Recursively sort JSON keys and convert `-0` to `0`, preserving explicit `null` vs missing keys according to schema nullability rules.
- **Target Files**: `src/normalization/body.ts`, `src/normalization/normalizer.ts`
- **Verification**: Unit test in `tests/normalization_body.test.ts`
- **Commit**: `add canonical json body normalizer`

#### Step 4.4: Semantic Request Diff Engine
- **Responsibility**: Deep structural comparator computing component diffs (method, path interpolation, query parameters, headers, JSON body) across normalized requests.
- **Target Files**: `src/comparator/diff.ts`, `src/comparator/types.ts`
- **Verification**: Unit tests in `tests/comparator_diff.test.ts`
- **Commit**: `implement structural request diff comparator`

---

### Phase 5: Early End-to-End Vertical Slice (TS vs Python)

#### Step 5.1: Early TS vs Python Differential Integration Test
- **Responsibility**: Connect the end-to-end loop: parse `petstore.json`, invoke real generated TS SDK and Python SDK on `addPet` and `getPets`, capture wire requests, normalize using operation contract, and assert 100% wire parity.
- **Target Files**: `tests/e2e_early_slice.test.ts`
- **Verification**: `pnpm test tests/e2e_early_slice.test.ts`
- **Commit**: `verify early ts python differential slice`

---

### Phase 6: Fast-Check Property Generation & Documented Regex Subset

#### Step 6.1: Fast-Check Seed & Replay Infrastructure
- **Responsibility**: Install `fast-check` and create seeded PRNG replay runner capturing seed and counterexample replay path.
- **Target Files**: `src/generator/seed.ts`, `package.json`
- **Verification**: Unit test in `tests/generator_seed.test.ts`
- **Commit**: `setup fast check seed infrastructure`

#### Step 6.2: String & Documented Regex Subset Arbitraries
- **Responsibility**: Build fast-check arbitraries for strings (Unicode corner cases, whitespace, boundary lengths) and regular expressions restricted to a documented safe subset (character classes, anchors, fixed lengths).
- **Target Files**: `src/generator/arbitraries/strings.ts`
- **Verification**: Unit test in `tests/generator_strings.test.ts`
- **Commit**: `create string regex schema arbitraries`

#### Step 6.3: Numeric, Date & Enum Arbitraries
- **Responsibility**: Build fast-check arbitraries for integers, floats, booleans (`0`, `-0`, `min`, `max`), date formats (`date`, `date-time`, `uuid`), and enum variants.
- **Target Files**: `src/generator/arbitraries/primitives.ts`
- **Verification**: Unit test in `tests/generator_primitives.test.ts`
- **Commit**: `create primitive boundary schema arbitraries`

#### Step 6.4: Collections & Nullable Object Arbitraries
- **Responsibility**: Build fast-check arbitraries for arrays (`minItems`, `maxItems`, `uniqueItems`) and objects with required fields, optional subsets, and explicit `null` vs omitted key permutations.
- **Target Files**: `src/generator/arbitraries/complex.ts`
- **Verification**: Unit test in `tests/generator_complex.test.ts`
- **Commit**: `create complex object schema arbitraries`

#### Step 6.5: Operation Input Schema Synthesizer
- **Responsibility**: Combine parameter and request body arbitraries to synthesize complete `OperationInputs` for any given `IROperation`.
- **Target Files**: `src/generator/synthesizer.ts`, `src/generator/index.ts`
- **Verification**: Unit test synthesizing inputs for PetStore operations in `tests/generator_synthesizer.test.ts`
- **Commit**: `synthesize complete operation input arbitraries`

---

### Phase 7: Divergence Classification & Seed/Path Counterexample Shrinking

#### Step 7.1: OPTIONAL_VS_NULL & Case Leak Classifier
- **Responsibility**: Implement classification logic detecting when one SDK omits a field while another sends explicit `null`, or when casing leaks (`camelCase` vs `snake_case`).
- **Target Files**: `src/comparator/classifiers/null_and_case.ts`
- **Verification**: Unit tests in `tests/classifier_null_case.test.ts`
- **Commit**: `classify optional null case divergences`

#### Step 7.2: Query Encoding & Header Auth Classifier
- **Responsibility**: Implement classification logic detecting query array style mismatches (comma-joined vs exploded) and auth header differences (missing `Bearer ` prefix).
- **Target Files**: `src/comparator/classifiers/query_and_auth.ts`
- **Verification**: Unit tests in `tests/classifier_query_auth.test.ts`
- **Commit**: `classify query auth divergence categories`

#### Step 7.3: Date/Time Format & Enum Value Classifier
- **Responsibility**: Implement classification logic detecting timestamp representation mismatches (ISO-8601 vs Unix epoch) and enum serialization errors (ordinal integer vs string name).
- **Target Files**: `src/comparator/classifiers/datetime_and_enum.ts`, `src/comparator/classifier.ts`
- **Verification**: Unit tests in `tests/classifier_datetime_enum.test.ts`
- **Commit**: `classify datetime enum divergence categories`

#### Step 7.4: Fast-Check Property Test Loop & Replay Path Shrinking
- **Responsibility**: Implement property-based multi-iteration test loop using `fc.check` with automatic shrinking of failing `OperationInputs` trees, capturing seed and replay path, and verifying the shrunk counterexample preserves the divergence category.
- **Target Files**: `src/shrinker/fast_check_shrink.ts`, `src/reporter/orchestrator.ts`
- **Verification**: Integration test verifying seed and replay path reproduction in `tests/shrinking.test.ts`
- **Commit**: `integrate fast check property shrinking`

---

### Phase 8: Go SDK Generation, Runner & Three-Way Multi-Language Parity

#### Step 8.1: Pinned Go SDK Generation Setup
- **Responsibility**: Add declarative configuration (`fixtures/sdks/configs/go.json`) and pnpm generation script target for the Go SDK (`fixtures/sdks/go/`) using OpenAPI Generator v7.7.0.
- **Target Files**: `fixtures/sdks/configs/go.json`, `scripts/generate_sdks.sh`
- **Verification**: Execute `pnpm generate:sdks` and verify generated Go package
- **Commit**: `setup generated go sdk package`

#### Step 8.2: Go SDK Runner Worker
- **Responsibility**: Create Go runner worker (`fixtures/runners/go_runner/main.go`) that imports the generated Go SDK, maps `operationId` + `OperationInputs` to generated Go structs/methods, and executes the SDK call.
- **Target Files**: `fixtures/runners/go_runner/main.go`
- **Verification**: Subprocess test calling generated Go SDK against `startCaptureServer` in `tests/go_runner.test.ts`
- **Commit**: `implement go sdk runner worker`

#### Step 8.3: Three-Way Parity Matrix Test (TS vs Python vs Go)
- **Responsibility**: Execute differential testing across all three generated SDKs on the PetStore specification asserting 100% 3-way wire parity.
- **Target Files**: `tests/e2e_three_way.test.ts`
- **Verification**: `pnpm test tests/e2e_three_way.test.ts`
- **Commit**: `verify three way sdk parity matrix`

---

### Phase 9: Developer CLI, JSON Config & Reporting

#### Step 9.1: Terminal Parity Report Formatter
- **Responsibility**: Format terminal output with operation pass/fail badges, categorized divergence explanations, minimal reproducer code blocks, execution seeds, and fast-check replay paths.
- **Target Files**: `src/reporter/terminal.ts`
- **Verification**: Formatting snapshot test in `tests/reporter_terminal.test.ts`
- **Commit**: `format terminal parity diff report`

#### Step 9.2: Machine-Readable JSON Report Output
- **Responsibility**: Create structured JSON report serializer for CI automation (`--json`) containing seed and replay path metadata.
- **Target Files**: `src/reporter/json.ts`
- **Verification**: Unit test validating JSON schema output in `tests/reporter_json.test.ts`
- **Commit**: `implement machine readable json reporter`

#### Step 9.3: CLI Arguments Parser & Flag Handling
- **Responsibility**: CLI parser handling `--spec`, `--ts`, `--py`, `--go`, `--seed`, `--replay-path`, `--iterations`, `--bail`, `--operations`, and `--json` with exit codes (0 = pass, 1 = divergence, 2 = config error).
- **Target Files**: `src/cli/index.ts`
- **Verification**: CLI execution unit tests in `tests/cli_args.test.ts`
- **Commit**: `implement cli argument flag parser`

#### Step 9.4: JSON-Only Configuration File Loader
- **Responsibility**: Support loading spec paths, runner commands, seed, and options strictly from `wireparity.config.json`.
- **Target Files**: `src/cli/config.ts`
- **Verification**: Unit tests loading valid/invalid `wireparity.config.json` files in `tests/cli_config.test.ts`
- **Commit**: `add json configuration file loader`

---

### Phase 10: Real-World Validation, Genuine Divergence Metrics & CI Pipeline

#### Step 10.1: Synthetic Regression & Bug Injection Suite
- **Responsibility**: Suite testing controlled injected bugs across SDKs, verifying detection and shrinking accuracy for each divergence classification category.
- **Target Files**: `tests/divergence_injection.test.ts`
- **Verification**: `pnpm test tests/divergence_injection.test.ts`
- **Commit**: `add synthetic divergence injection suite`

#### Step 10.2: Real-World External OpenAPI Spec Benchmark
- **Responsibility**: Benchmark suite running WireParity on external, untouched OpenAPI specifications (e.g. GitHub REST subset, Stripe OpenAPI subset) with untouched generated SDKs.
- **Target Files**: `fixtures/specs/realworld/`, `tests/realworld_benchmark.test.ts`
- **Verification**: `pnpm test tests/realworld_benchmark.test.ts`
- **Commit**: `add real world specification benchmark`

#### Step 10.3: Telemetry & Benchmark Metrics Reporter
- **Responsibility**: Implement telemetry engine that outputs metrics cleanly distinguishing **genuine discovered divergences** from **synthetic test bugs**, tracking operations covered, total cases tested, shrinking reduction percentage, and execution runtime.
- **Target Files**: `src/telemetry/metrics.ts`
- **Verification**: Unit test asserting telemetry metrics calculation in `tests/telemetry.test.ts`
- **Commit**: `add benchmark telemetry metrics reporter`

#### Step 10.4: GitHub Actions Continuous Integration Workflow
- **Responsibility**: Configure `.github/workflows/ci.yml` running pnpm typechecks, unit tests, and the multi-language SDK differential suite on Node.js, Python, and Go environments.
- **Target Files**: `.github/workflows/ci.yml`
- **Verification**: Validate CI YAML configuration locally
- **Commit**: `configure github actions ci workflow`

---

## Operating Guidelines During Execution

1. **Strict Single-Step Execution**: Execute one micro-step at a time. No jumping ahead.
2. **Mandatory Verification**: Every single step is immediately validated with `pnpm typecheck && pnpm test`.
3. **Commit Message Standard**: Exactly **4–6 words, all lowercase, no colons, no dashes, no buzzwords** (e.g. `define contract aware operation ast`).
4. **Focused Context**: Open and edit only the files required for the current micro-step.
