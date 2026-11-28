#!/usr/bin/env bash
#MISE description="Run all untimed benchmark fixture checks in isolated processes"
#MISE hide=true
#MISE depends=["fixture:bench"]
set -euo pipefail
exec deno run --frozen --allow-read --allow-env=__MINIMATCH_TESTING_PLATFORM__ --allow-run tools/bench/check.ts --check "$@"
