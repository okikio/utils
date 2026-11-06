#!/usr/bin/env bash
#MISE description="Build ESM, CommonJS and declarations for all publishable packages"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/npm.ts build
