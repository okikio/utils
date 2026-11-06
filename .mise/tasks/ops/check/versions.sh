#!/usr/bin/env bash
#MISE description="Check package and JSR release-version agreement"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec deno run --frozen --allow-read .bumpy/release.ts check
