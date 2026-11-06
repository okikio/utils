#!/usr/bin/env bash
#MISE description="Emit the pinned competitor fixture for comparison tests and benchmarks"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/bench/prepare.ts
