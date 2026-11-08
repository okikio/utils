#!/usr/bin/env bash
#MISE description="Test workflow recovery, durable queues and persisted state against explicit UTILS_TEST_DATABASE_URL"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/testing/run.ts postgres "$@"
