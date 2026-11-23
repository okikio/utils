#!/usr/bin/env bash
#MISE description="Dry-run JSR publication of the source workspace without uploading"
#MISE hide=true
#MISE depends=[]
# tools/workspace/run.ts owns the dry-run flags, so CI and this task stay the same.
set -euo pipefail
exec node tools/workspace/run.ts check --kind jsr
