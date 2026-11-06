#!/usr/bin/env bash
#MISE description="Summarize explicit freeze reports from one source checkpoint with raw-file hashes"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/bench/freeze/summarize.ts "$@"
