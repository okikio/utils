#!/usr/bin/env bash
#MISE description="Compile source and public inference fixtures"
#MISE hide=true
#MISE depends=[]
#MISE sources=["packages/**/*", "tools/**/*", "tests/**/*", "examples/**/*", "bench/**/*", "tsconfig.json", "deno.jsonc", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "mise.toml", "tsdown.config.ts"]
#MISE outputs=[]
#MISE cache={ enabled = true, env = ["CI", "NODE_OPTIONS", "NODE_ENV"] }
set -euo pipefail
exec node node_modules/typescript-native/bin/tsc --pretty false --project tsconfig.json
