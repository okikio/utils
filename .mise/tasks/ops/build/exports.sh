#!/usr/bin/env bash
#MISE description="Regenerate umbrella forwarding modules from focused package exports"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec deno run --frozen --allow-read --allow-write --allow-env --allow-ffi tools/sync-utils-exports.ts --write
