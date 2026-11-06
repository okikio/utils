#!/usr/bin/env bash
#MISE description="Run all untimed benchmark fixture checks in isolated processes"
#MISE hide=true
#MISE depends=["ops:prepare:bench"]
set -euo pipefail
exec deno run --frozen --allow-read --allow-run tools/bench/check.ts --check "$@"
