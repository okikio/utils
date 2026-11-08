#!/usr/bin/env bash
#MISE description="Run prepared library comparisons: deno, node or bun, then optional selectors"
#MISE hide=true
#MISE depends=["fixture:bench"]
set -euo pipefail
exec node tools/testing/run.ts comparisons "$@"
