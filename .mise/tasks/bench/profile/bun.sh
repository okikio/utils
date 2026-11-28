#!/usr/bin/env bash
#MISE description="Record JavaScriptCore CPU profiles for selected HTTP workloads"
#MISE hide=true
#MISE depends=["fixture:bench"]
set -euo pipefail
exec node tools/bench/profile/bun.ts "$@"
