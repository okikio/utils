#!/usr/bin/env bash
#MISE description="Validate the prepared frozen/plain experiment without timing or rewriting evidence"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
node tools/bench/freeze/verify.ts
exec node bench/freeze/freeze.bench.ts --validate-only
