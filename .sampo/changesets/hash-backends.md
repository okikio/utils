---
npm/@okikio/hash: minor
npm/@okikio/utils: minor
---

Add entry points that pin one hash backend with no fallback: `/packed` (the WebAssembly module embedded in the JavaScript), `/native` (`node:crypto`), `/portable` (pure JavaScript) and `/web` (Web Crypto, asynchronous), beside the existing `/wasm`. Export the raw modules as `@okikio/hash/wasm/<family>.wasm` for hosts and bundlers that import WebAssembly directly. Add KMAC128 and KMAC256 to the `sha3` family.
