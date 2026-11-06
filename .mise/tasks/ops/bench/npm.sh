#!/usr/bin/env bash
#MISE description="Measure installed npm root imports; --check validates fixtures without timing"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec deno run --frozen --no-check --allow-read --allow-run bench/npm-imports.bench.ts "$@"
