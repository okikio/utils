#!/usr/bin/env bash
#MISE description="Check that committed hash WebAssembly modules match their Rust source"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
exec node tools/packages/wasm.ts
