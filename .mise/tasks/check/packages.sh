#!/usr/bin/env bash
#MISE description="Check publishable package metadata and targets"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec deno run --frozen --allow-read --allow-env --allow-run=pnpm tools/packages/check.ts
