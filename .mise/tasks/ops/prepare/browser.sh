#!/usr/bin/env bash
#MISE description="Install the Chromium revision selected by the pinned Playwright package"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node node_modules/playwright/cli.js install chromium "$@"
