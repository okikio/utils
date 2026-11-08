#!/usr/bin/env bash
#MISE description="Audit automatically discovered tests and their declared host requirements"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/testing/run.ts check
