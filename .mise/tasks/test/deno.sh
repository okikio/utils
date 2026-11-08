#!/usr/bin/env bash
#MISE description="Run discovered portable tests and Deno adapters; optional file or directory selectors"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/testing/run.ts deno "$@"
