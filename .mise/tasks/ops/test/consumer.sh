#!/usr/bin/env bash
#MISE description="Run canonical tests against installed artifacts on Deno, Node ESM/CommonJS and Bun"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
export UTILS_BUN="${UTILS_BUN:-bun}"
exec node tools/testing/consumer.ts "$@"
