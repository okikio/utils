#!/usr/bin/env bash
#MISE description="Compile source and public inference fixtures"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node node_modules/typescript-native/bin/tsc --pretty false --project tsconfig.json
