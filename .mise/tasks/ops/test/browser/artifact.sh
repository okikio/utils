#!/usr/bin/env bash
#MISE description="Test real Chromium against the installed npm archive consumer"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/testing/browser.ts --artifact "$@"
