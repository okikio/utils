#!/usr/bin/env bash
#MISE description="Compile source and public inference fixtures"
#MISE hide=true
#MISE depends=[]
# Source inputs reflect the TypeScript compiler graph, not downloaded packages or build output.
# Broad file globs previously traversed generated/installed content and stalled CI.
#MISE sources=["packages/**/*.{ts,tsx,mts,cts,json,jsonc}", "tools/**/*.{ts,tsx,mts,cts,json,jsonc}", "tests/**/*.{ts,tsx,mts,cts,json,jsonc}", "examples/**/*.{ts,tsx,mts,cts,json,jsonc}", "bench/**/*.{ts,tsx,mts,cts,json,jsonc}", "tsconfig.json", "deno.jsonc", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "mise.toml", "tsdown.config.ts", "!**/node_modules/**", "!**/dist/**", "!**/.tmp/**", "!**/.generated/**"]
#MISE outputs=[]
#MISE cache={ enabled = true, env = ["CI", "NODE_OPTIONS", "NODE_ENV"] }
set -euo pipefail
exec node node_modules/typescript-native/bin/tsc --pretty false --project tsconfig.json
