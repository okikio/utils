#!/usr/bin/env bash
#MISE description="Check formatting without modifying authored files"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec deno fmt --check
