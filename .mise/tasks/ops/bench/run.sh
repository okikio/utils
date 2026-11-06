#!/usr/bin/env bash
#MISE description="Record native benchmark reports with exact inputs and runtime metadata"
#MISE hide=true
#MISE depends=["ops:prepare:bench"]
set -euo pipefail
exec deno run --frozen -A tools/bench/measure.ts "$@"
