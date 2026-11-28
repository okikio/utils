#!/usr/bin/env bash
#MISE description="Execute workspace examples on an explicit native runtime"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/testing/examples/execute.ts "$@"
