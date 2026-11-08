#!/usr/bin/env bash
#MISE description="Record isolated native CPU profiles for selected workloads"
#MISE hide=true
#MISE depends=["ops:prepare:bench"]
set -euo pipefail
exec node tools/bench/profile.ts "$@"
