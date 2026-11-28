#!/usr/bin/env bash
#MISE description="Check native library and tooling owners without ordering source-only test dependencies"
#MISE hide=true
#MISE depends=["check:packages"]
set -euo pipefail
# Checks consume source without prerequisite artifacts, so development-consumer cycles need no ordering.
# Each selected owner runs its own required script. Recursive run would skip a missing script in a mixed selection.
exec pnpm --config.verifyDepsBeforeRun=error --filter './packages/**' --filter ./tools --fail-if-no-match --no-sort --workspace-concurrency 4 -r exec pnpm --config.verifyDepsBeforeRun=error run check
