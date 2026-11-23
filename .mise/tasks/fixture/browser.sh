#!/usr/bin/env bash
#MISE description="Install selected browser revisions from the pinned Playwright package"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node node_modules/playwright/cli.js install "$@"
