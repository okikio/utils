#!/usr/bin/env bash
#MISE description="List all tests with runtime or resource requirements"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/testing/run.ts list "$@"
