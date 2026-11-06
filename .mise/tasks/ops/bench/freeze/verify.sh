#!/usr/bin/env bash
#MISE description="Verify freeze source, dependency and treatment hashes; read-only unless --write"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/bench/freeze/verify.ts "$@"
