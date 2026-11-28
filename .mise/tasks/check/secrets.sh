#!/usr/bin/env bash
#MISE description="Scan the commit history for committed secrets with gitleaks"
#MISE hide=true
#MISE depends=[]
# The default scan covers this clone's available history, including a valid shallow history.
# Git's native traversal status must confirm that scanning completed. Reviewed test fixtures use exact
# path:rule:line fingerprints in .gitleaksignore, never whole files or rules.
set -euo pipefail
exec mise exec gitleaks -- node tools/security/secrets.ts "$@"
