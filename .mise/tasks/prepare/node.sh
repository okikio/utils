#!/usr/bin/env bash
#MISE description="Install the frozen workspace dependency graph"
#MISE depends=[]
# Other tasks depend on this one by name. A frozen install fails, rather than
# rewriting pnpm-lock.yaml, when package.json and the lockfile disagree.
set -euo pipefail
exec pnpm install --frozen-lockfile
