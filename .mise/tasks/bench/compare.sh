#!/usr/bin/env bash
#MISE description="Compare six fresh counterbalanced HTTP parity measurements"
#MISE hide=true
#MISE depends=["ops:prepare:bench"]
set -euo pipefail
exec deno run --frozen -A tools/bench/repeat.ts "$@"
