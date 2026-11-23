#!/usr/bin/env bash
#MISE description="Compile and execute maintained documentation examples"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/testing/run.ts docs "$@"
