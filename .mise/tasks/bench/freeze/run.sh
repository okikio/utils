#!/usr/bin/env bash
#MISE description="Measure prepared frozen/plain treatments; pass --output and --seed for new evidence"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node bench/freeze/freeze.bench.ts "$@"
