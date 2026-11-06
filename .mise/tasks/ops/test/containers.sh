#!/usr/bin/env bash
#MISE description="Test worker recovery, streaming through nginx and PostgreSQL promotion with Docker"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/testing/run.ts containers "$@"
