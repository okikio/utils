# Hash design

These pages record the design for the next version of `@okikio/hash`: more algorithms, WebAssembly (WASM) builds
from maintained Rust crates, and entry points that choose the fastest backend for the host. For the current API, read
the [package README](../../packages/hash/README.md) and the [capability guide](../../packages/hash/capabilities.md).

1. [Backends and the default choice](01-backends.md): packed WASM, WASM files, `node:crypto`, Web Crypto and pure
   JavaScript, and the rules that pick one.
2. [Algorithms, families and crates](02-algorithms.md): every included algorithm, its crate, and what is left out.
3. [Entry points](03-entry-points.md): family paths, backend suffixes, Base64 and hex paths, shared memory and
   wide-arithmetic builds.
4. [Measurements](04-measurements.md): the benchmarks and feature probes behind each decision.

## Delivery plan

Each step is one pull request that passes the package checks on Deno, Node.js and Bun.

1. This design.
2. The Rust workspace, the build and pack tool, and the `sha2`, `sha3` and `blake` families with tests against
   published vectors.
3. `legacy`, `national`, `contest`, `mac`, `fast` and `checksum`.
4. Backend suffixes, the Base64 and hex entry points, and the automatic choice.
5. `/shared` and the wide-arithmetic `fast` module.
6. The same change in `okikio/utils`, with its package names.
