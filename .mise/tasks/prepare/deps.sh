#!/usr/bin/env bash
#MISE description="Install the frozen workspace dependency graph"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec pnpm install --frozen-lockfile
