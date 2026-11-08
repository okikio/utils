#!/usr/bin/env bash
#MISE description="Record counterbalanced independent HTTP implementation measurements"
#MISE hide=true
#MISE depends=["prepare:bench"]
set -euo pipefail
exec node tools/bench/challenger-repeat.ts "$@"
