#!/usr/bin/env bash
#MISE description="Validate the mise task graph"
#MISE hide=true
#MISE depends=[]
# Fails on a task that names a missing dependency, a malformed #MISE header, or a dependency cycle.
set -euo pipefail
exec mise tasks validate
