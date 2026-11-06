#!/usr/bin/env bash
#MISE description="Run discovered portable tests and native Node adapters; optional selectors"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/testing/run.ts node "$@"
