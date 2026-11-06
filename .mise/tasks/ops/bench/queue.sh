#!/usr/bin/env bash
#MISE description="Measure bounded PostgreSQL queue completion batches against an explicit disposable database"
#MISE hide=true
#MISE depends=["ops:prepare:deps"]
set -euo pipefail
exec deno run --frozen -A tools/bench/queue.ts "$@"
