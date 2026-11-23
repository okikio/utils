#!/usr/bin/env bash
#MISE description="Test consumer bundles and browser-selected exports in a Web API host"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
mkdir -p .tmp/artifacts/tests/native
{
  deno run --frozen -A tools/packages/bundles.ts || exit "$?"
  deno run --frozen -A tools/packages/browser.ts
} 2>&1 | tee .tmp/artifacts/tests/native/bundles.log
