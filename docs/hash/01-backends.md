# Hash backends and how the default chooses one

Status: proposed. This page records the design for the next version of `@okikio/hash`. The current package
implements SHA-2 through the host's built-in hash, Web Crypto and `@noble/hashes`. The rest of this page is not
implemented yet.

## The problem

A hash function gives the same result on every runtime. The cost of that result does not. On Node.js, Deno and Bun the
built-in `node:crypto` module computes a 1 KiB SHA-256 digest in about 1–3 µs, because OpenSSL uses the CPU's SHA
instructions. In a browser there is no `node:crypto`, and Web Crypto is asynchronous: a 64-byte digest costs 3–39 µs,
mostly in the promise round trip. A pure JavaScript hash works everywhere, but it is 5–20 times slower than WebAssembly
(WASM) for SHA-3 and BLAKE. Most algorithms have no built-in implementation on any runtime.

So no single backend is best. The package offers five, and the default entry point picks one for each call.

## The five backends

| Backend  | What it is                                                                 | Works on                                         | Sync |
| -------- | -------------------------------------------------------------------------- | ------------------------------------------------ | ---- |
| packed   | WASM bytes compressed with deflate, stored as a Z85 string inside the JS   | Every host with `WebAssembly` and `DecompressionStream` | yes, after `ready()` |
| wasm     | The same WASM as a separate `.wasm` file, loaded with `fetch` or a file read | Every host with `WebAssembly` and file or URL access | yes, after `ready()` |
| native   | `node:crypto` through `process.getBuiltinModule`                           | Node.js 22.3+, Deno, Bun                         | yes  |
| web      | `crypto.subtle.digest`                                                     | Browsers, Deno, Bun, Node.js, workers            | no   |
| portable | Pure JavaScript from `@noble/hashes` and the package's own CRC code       | Every host, including QuickJS                    | yes  |

All WASM comes from one Rust workspace in `packages/hash/wasm/`. It uses maintained crates (RustCrypto, the official
BLAKE3 crate, `xxhash-rust`, `crc` and others). The package does not contain its own hash implementations, except the
small CRC tables it already has. [Algorithms](02-algorithms.md) lists each crate.

## Why packed WASM is the default

Packed WASM needs no separate file. A bundler, JSR, a CDN and a service worker all see one JavaScript module. Nothing
needs a URL, a loader plugin or a `fetch` permission. The JS module's own integrity check (Subresource Integrity, a
lockfile hash or a JSR checksum) also covers the WASM, because the WASM is part of the module text.

The cost is time on the first call. The host must decode Z85 and decompress the bytes before it can compile them.
[Measurements](04-measurements.md) puts this at 25–177 ms on the first load and the same as raw WASM after that. Packing
makes the bytes 20–25% smaller before HTTP compression.

Use the `wasm` entry point instead when you serve files yourself and can set `Content-Type: application/wasm`. The host
can then compile while it downloads (`WebAssembly.compileStreaming`), and the browser cache stores the compiled code.

## How the default chooses

The default entry point applies these rules in order for each algorithm and each call:

1. If the host has `node:crypto`, the algorithm is one that OpenSSL accelerates (SHA-1 and SHA-2), and the input is at
   least 512 bytes, use **native**. Below 512 bytes, the WASM call is faster on Node.js and Deno because it avoids the
   OpenSSL object setup. Bun is faster natively at every size, so on Bun the limit is 0.
2. Otherwise, if `WebAssembly` is present and compiles the module, use **packed**.
3. Otherwise, if `@noble/hashes` implements the algorithm, use **portable**.
4. Otherwise, throw `UnsupportedError`. The message names the algorithm, the missing feature and the entry points that
   would work.

The default does not choose **web**. Web Crypto is asynchronous, slower for small inputs and limited to SHA-1 and SHA-2.
Choose the `web` entry point when policy requires the host's own implementation.

Rule 2 can fail even when `WebAssembly` exists. A page whose Content Security Policy (CSP) does not allow
`'wasm-unsafe-eval'` rejects every WASM compile. The default catches that failure once, records it and moves to rule 3.
It never retries a refused compile on each call.

## Synchronous calls need a loaded module

Compiling WASM and decompressing a packed module are asynchronous in browsers. A synchronous `digest()` cannot wait
for them. The rule is simple:

- Asynchronous functions load the family they need on first use.
- Synchronous functions use a family that is already loaded. Call `await ready('sha3', 'blake')` once at startup.
- A synchronous call for a family that is not loaded uses **native** or **portable** if one of them has the algorithm.
  Otherwise it throws `NotReadyError`, which names the family to load.

Every host can compile WASM synchronously with `new WebAssembly.Module(bytes)`, but `DecompressionStream` has no
synchronous form, and Chrome limits synchronous compiles on the main thread. So the package always loads
asynchronously, and the rule is the same everywhere.

## Memory and state in the WASM

Each module has a fixed input window (64 KiB), a fixed output buffer and a fixed table of hash states. It has no memory
allocator. JavaScript copies at most one window of input into WASM memory, calls `update`, and repeats. A digest of
any length uses the same memory. A state slot is freed when its JS owner calls `finish` or `dispose`, or when a
`FinalizationRegistry` callback runs for an abandoned state.

Rust code uses `#![forbid(unsafe_code)]` in every crate except `abi`. That one crate owns the exported functions and
the static memory regions. Each `unsafe` block in it has a `SAFETY:` comment that states why the access cannot race and
cannot go out of bounds.

## Security notes

- Hash results never depend on the backend. The test suite runs every algorithm on every backend against the same
  published test vectors.
- MD2, MD4, MD5, SHA-1, RIPEMD-128, GOST R 34.11-94 and Tiger are broken or weak for collision resistance. They live in
  the `legacy` family, and their names carry no warning-free alias. `sha1-checked` detects the known SHA-1 collision
  attack and is the better choice when SHA-1 is required.
- Non-cryptographic hashes (xxHash, rapidhash, MurmurHash3, CRC and others) are for indexes, deduplication and
  corruption checks. Do not use them where an attacker chooses the input and a collision has a cost. Use a keyed hash
  such as SipHash, HighwayHash or BLAKE3 keyed mode in that case.
- Keys passed to keyed hashes are copied into WASM memory and zeroed when the state is disposed. JavaScript strings
  cannot be zeroed, so pass keys as `Uint8Array`.
- WASM runs inside the same process and sandbox as the JavaScript that calls it. It cannot read files or the network.
  It has no imports.
