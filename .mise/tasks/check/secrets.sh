#!/usr/bin/env bash
#MISE description="Scan the commit history for committed secrets with gitleaks"
#MISE hide=true
#MISE depends=[]
# Scans every commit this clone holds (a shallow CI clone holds the tested commit). Reviewed test
# fixtures are listed in .gitleaksignore as exact path:rule:line fingerprints, never whole files or rules.
set -euo pipefail
exec gitleaks git --redact --no-banner --log-level warn --exit-code 1 "$@" .
