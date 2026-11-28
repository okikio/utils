#!/usr/bin/env bash
#MISE description="Check Sampo release metadata without running source tests again"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/releases/plan.ts
