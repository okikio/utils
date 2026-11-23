#!/usr/bin/env bash
#MISE description="Validate the GitHub Actions workflows and local actions"
#MISE hide=true
#MISE depends=[]
# jactionlint (jdx's actionlint fork) checks workflow syntax, expressions, job
# dependencies, token permissions and script injection, and runs shellcheck on
# each run step. Mise installs both pinned releases on first use, so
# contributors who never touch workflows do not install them.
set -euo pipefail
exec mise exec aqua:jdx/jactionlint@2.6.0 aqua:koalaman/shellcheck@0.11.0 -- jactionlint "$@"
