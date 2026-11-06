#!/usr/bin/env bash
#MISE description="Check Bumpy release metadata without running source tests again"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec pnpm exec bumpy ci check --strict
