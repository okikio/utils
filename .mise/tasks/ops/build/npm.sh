#!/usr/bin/env bash
#MISE description="Build ESM and declarations for all publishable packages"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/packages/npm.ts build
