#!/usr/bin/env bash
#MISE description="Run the SQL package through every ORM, driver, pooler and PostgreSQL-compatible server with Docker"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/testing/run.ts interop "$@"
