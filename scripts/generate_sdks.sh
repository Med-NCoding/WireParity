#!/usr/bin/env bash
# scripts/generate_sdks.sh
#
# Generates untouched TypeScript, Python, and Go SDKs from the canonical PetStore
# spec using the pinned OpenAPI Generator runtime (v7.7.0).
#
# Usage:
#   npm run generate:sdks
#
# Prerequisites:
#   - Java 11+ available on PATH  (required by openapi-generator-cli)
#   - Node.js / npx available on PATH
#   - Internet access on first run (downloads the generator JAR ~30 MB)
#
# The OpenAPI Generator runtime version is pinned to 7.7.0 via the
# OPENAPI_GENERATOR_VERSION env var, overriding any local openapitools.json.
#
# Output (gitignored, regenerated on demand):
#   fixtures/sdks/typescript/   - typescript-fetch SDK
#   fixtures/sdks/python/       - python (urllib3) SDK
#   fixtures/sdks/go/           - go SDK

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPEC="$REPO_ROOT/fixtures/specs/petstore.json"
CONFIGS_DIR="$REPO_ROOT/fixtures/sdks/configs"
TS_OUT="$REPO_ROOT/fixtures/sdks/typescript"
PY_OUT="$REPO_ROOT/fixtures/sdks/python"
GO_OUT="$REPO_ROOT/fixtures/sdks/go"

# Pin the OpenAPI Generator JAR version (separate from the npm CLI package version)
export OPENAPI_GENERATOR_VERSION="7.7.0"

echo "==> WireParity SDK Generator (OpenAPI Generator runtime v${OPENAPI_GENERATOR_VERSION})"
echo "    Spec: $SPEC"
echo ""

# Verify Java is available before attempting generation
if ! command -v java &>/dev/null; then
  echo "ERROR: Java not found. Java 11+ is required to run the OpenAPI Generator." >&2
  echo "       Install Java from https://adoptium.net/ or via your package manager." >&2
  exit 1
fi

# Ensure output directories exist and are clean
mkdir -p "$TS_OUT" "$PY_OUT" "$GO_OUT"
rm -rf "${TS_OUT:?}"/* "${PY_OUT:?}"/* "${GO_OUT:?}"/*

# ---------------------------------------------------------------------------
# TypeScript SDK (typescript-fetch)
# ---------------------------------------------------------------------------
echo "[1/3] Generating TypeScript SDK (typescript-fetch) → $TS_OUT"
npx --yes @openapitools/openapi-generator-cli generate \
  --generator-name typescript-fetch \
  --input-spec "$SPEC" \
  --output "$TS_OUT" \
  --config "$CONFIGS_DIR/ts.json" \
  --skip-validate-spec

echo "      ✓ TypeScript SDK generated"
echo ""

# ---------------------------------------------------------------------------
# Python SDK (urllib3)
# ---------------------------------------------------------------------------
echo "[2/3] Generating Python SDK (python/urllib3) → $PY_OUT"
npx --yes @openapitools/openapi-generator-cli generate \
  --generator-name python \
  --input-spec "$SPEC" \
  --output "$PY_OUT" \
  --config "$CONFIGS_DIR/python.json" \
  --skip-validate-spec

echo "      ✓ Python SDK generated"
echo ""

# ---------------------------------------------------------------------------
# Go SDK (go)
# ---------------------------------------------------------------------------
echo "[3/3] Generating Go SDK (go) → $GO_OUT"
npx --yes @openapitools/openapi-generator-cli generate \
  --generator-name go \
  --input-spec "$SPEC" \
  --output "$GO_OUT" \
  --config "$CONFIGS_DIR/go.json" \
  --skip-validate-spec

echo "      ✓ Go SDK generated"
echo ""

# ---------------------------------------------------------------------------
# Verification — assert expected entry points exist
# ---------------------------------------------------------------------------
TS_ENTRY="$TS_OUT/src/index.ts"
PY_INIT="$PY_OUT/wireparity_petstore/__init__.py"
GO_CLIENT="$GO_OUT/client.go"

ERRORS=0

if [ -f "$TS_ENTRY" ]; then
  echo "✓ TypeScript entry point found: $TS_ENTRY"
else
  echo "✗ TypeScript entry point MISSING: $TS_ENTRY" >&2
  ERRORS=$((ERRORS + 1))
fi

if [ -f "$PY_INIT" ]; then
  echo "✓ Python package init found:    $PY_INIT"
else
  echo "✗ Python package init MISSING:  $PY_INIT" >&2
  ERRORS=$((ERRORS + 1))
fi

if [ -f "$GO_CLIENT" ]; then
  echo "✓ Go client found:              $GO_CLIENT"
else
  echo "✗ Go client MISSING:            $GO_CLIENT" >&2
  ERRORS=$((ERRORS + 1))
fi

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo "==> All SDKs generated successfully."
else
  echo "==> Generation completed with $ERRORS verification error(s). Check output above." >&2
  exit 1
fi

