#!/usr/bin/env bash
#MISE description="Check locked dependencies against published advisories"
#MISE hide=true
#MISE depends=[]
# deno audit reads deno.lock; osv-scanner reads pnpm-lock.yaml and Cargo.lock. Reviewed exceptions,
# each with a reason and an expiry date, live in osv-scanner.toml. Needs network access.
set -euo pipefail
exec node tools/security/check.ts
