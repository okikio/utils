#!/usr/bin/env bash
#MISE description="Run opt-in two-hour PostgreSQL writes, lease renewal and primary promotion"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/testing/run.ts soak "$@"
