#!/usr/bin/env bash
#MISE description="Check package and JSR release-version agreement"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/releases/versions.ts check
