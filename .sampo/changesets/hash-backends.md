---
npm/@okikio/hash: minor
npm/@okikio/utils: minor
---

Add entry points that pin one hash backend with no fallback: `/packed` (the WebAssembly module embedded in the JavaScript), `/native` (`node:crypto`), `/portable` (pure JavaScript) and `/web` (Web Crypto, asynchronous), beside the existing `/wasm`. Export the raw modules as `@okikio/hash/wasm/<family>.wasm` for hosts and bundlers that import WebAssembly directly. Add KMAC128 and KMAC256 to the `sha3` family.

The `fast` family loads a second build that uses the WebAssembly wide-arithmetic feature where the host has it (Bun, Firefox 155). rapidhash runs 5 to 7 times faster there, and short XXH3 inputs up to 2.6 times faster. Results are the same. The raw build is exported as `@okikio/hash/wasm/fast-wide.wasm`.
