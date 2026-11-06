#!/usr/bin/env bash
#MISE description="Compile browser, worker and Node consumer views without unrelated runtime globals"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/testing/portable.ts
