#!/usr/bin/env bash
#MISE description="Test real Chromium input, pointer capture and module Worker ownership"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/testing/browser.ts "$@"
