#!/usr/bin/env bash
#MISE description="Prepare current frozen/plain treatments and record verified dependency provenance"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
node tools/bench/freeze/prepare.ts
exec node tools/bench/freeze/verify.ts --write
