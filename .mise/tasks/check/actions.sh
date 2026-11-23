#!/usr/bin/env bash
#MISE description="Validate the GitHub Actions workflows and local actions"
#MISE hide=true
#MISE depends=[]
# actionlint checks workflow syntax, expressions, job dependencies and the
# shell in each run step. Mise installs the pinned release on first use, so
# contributors who never touch workflows do not install it.
set -euo pipefail
exec mise exec aqua:rhysd/actionlint@1.7.12 -- actionlint "$@"
