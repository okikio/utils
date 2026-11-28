#!/usr/bin/env bash
#MISE description="Validate JSR source publication without uploading any package"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
args=(publish --dry-run --frozen-lockfile)
if [[ -z "${CI:-}" ]]; then args+=(--allow-dirty); fi
exec deno "${args[@]}"
