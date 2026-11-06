#!/usr/bin/env bash
#MISE description="Check publishable package metadata and targets"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec deno run --frozen --allow-read tools/packages/check.ts
