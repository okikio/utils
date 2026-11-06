#!/usr/bin/env bash
#MISE description="Check pinned Hono fixture source and executable mappings"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec deno run --frozen --allow-read --allow-env tools/testing/hono-inventory.ts check
