#!/usr/bin/env bash
#MISE description="Build, inspect, pack and test physically installed npm archives"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/packages/npm.ts verify
