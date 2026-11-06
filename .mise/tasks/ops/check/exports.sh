#!/usr/bin/env bash
#MISE description="Check focused-package and umbrella export agreement"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec deno run --frozen --allow-read --allow-env --allow-ffi tools/sync-utils-exports.ts --check
