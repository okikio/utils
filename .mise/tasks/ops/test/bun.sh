#!/usr/bin/env bash
#MISE description="Run the same discovered portable tests and Bun Web Workers; optional selectors"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/testing/run.ts bun "$@"
