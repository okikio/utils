#!/usr/bin/env bash
#MISE description="Lint authored TypeScript and JavaScript"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec deno lint
