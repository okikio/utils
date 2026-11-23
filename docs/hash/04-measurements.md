# Measurements behind the design

Status: evidence for the proposal in [Backends](01-backends.md). These numbers come from a prototype outside the
repository. The package benchmark (`mise run bench -- --project hash`) will replace them when the WASM build lands.

Hosts: Linux x86-64 VM, Intel Xeon at 2.3 GHz with the SHA extensions (`sha_ni`). Deno 2.9.8 (V8 15.0), Node.js 22.23, Bun 1.4.4, Chrome for Testing 153 through
Playwright. Each number is the median of repeated calls after warm-up. Treat differences below 10% as noise.

## SHA-256 by backend

Time per call, in microseconds.

| Input  | Host    | node:crypto | Rust WASM (9.5 KB) | hash-wasm (C) | @std/crypto | @noble/hashes | Web Crypto |
| ------ | ------- | ----------- | ------------------ | ------------- | ----------- | ------------- | ---------- |
| 64 B   | Node.js | 1.37        | **0.50**           | 0.57          | 1.59        | 1.65          | 37.1       |
| 64 B   | Deno    | 2.71        | **1.50**           | 1.56          | 1.89        | 2.87          | 39.4       |
| 64 B   | Bun     | **0.36**    | 0.68               | 0.73          | 1.58        | 1.20          | 28.9       |
| 64 B   | Chrome  | —           | **0.59**           | 0.69          | 1.34        | 2.92          | 3.52       |
| 1 KiB  | Node.js | **1.83**    | 3.03               | 3.16          | 4.17        | 6.67          | 35.8       |
| 1 KiB  | Deno    | **3.15**    | 4.58               | 6.71          | 4.23        | 7.65          | 46.9       |
| 1 KiB  | Bun     | **0.86**    | 4.26               | 4.38          | 5.44        | 5.91          | 25.2       |
| 1 KiB  | Chrome  | —           | **3.23**           | 3.76          | 3.95        | 15.6          | 4.08       |

What this shows:

- WASM wins small inputs on Node.js, Deno and Chrome. OpenSSL's per-call setup costs more than the 64-byte hash.
- `node:crypto` wins from about 512 bytes, because SHA-NI hashes each block in a few cycles. Bun's binding is cheap
  enough to win at every size. This is rule 1 of the default.
- Web Crypto costs 25–47 µs per call outside browsers. Its promise path dominates. The default never picks it.

## Every prototype algorithm on Node.js

Time per call in microseconds. `z.oz` is `opt-level = "z"` plus `wasm-opt -Oz`; `s.o3` is `opt-level = "s"` plus
`wasm-opt -O3`; `3.o3` is `opt-level = 3` plus `wasm-opt -O3`.

| Algorithm  | Input | WASM z.oz | WASM s.o3 | WASM 3.o3 | @noble/hashes | node:crypto |
| ---------- | ----- | --------- | --------- | --------- | ------------- | ----------- |
| SHA-256    | 64 B  | 1.32      | 0.96      | **0.56**  | 1.35          | 1.18        |
| SHA-512    | 64 B  | 0.80      | **0.48**  | **0.47**  | 2.88          | 1.45        |
| SHA3-256   | 64 B  | 0.74      | **0.60**  | **0.61**  | 4.79          | 1.56        |
| BLAKE2b    | 64 B  | 0.40      | **0.37**  | **0.35**  | 4.09          | 1.63        |
| BLAKE3     | 64 B  | 0.50      | **0.32**  | **0.30**  | 3.17          | —           |
| MD5        | 64 B  | 0.47      | 0.43      | **0.41**  | 2.27          | 1.34        |
| SHA-1      | 64 B  | 0.73      | 0.65      | **0.38**  | 1.30          | 1.18        |
| SHA-256    | 1 MiB | 6149      | 6171      | 2946      | 5276          | **575**     |
| SHA-512    | 1 MiB | 4103      | 2163      | 1883      | 9617          | **1299**    |
| SHA3-256   | 1 MiB | 3315      | 2713      | 3788      | 27411         | **1879**    |
| BLAKE2b    | 1 MiB | 1042      | 975       | 959       | 18574         | **941**     |
| BLAKE3     | 1 MiB | 2540      | **1196**  | 1241      | 18405         | —           |
| MD5        | 1 MiB | 1344      | 1346      | 1431      | 11611         | **1288**    |
| SHA-1      | 1 MiB | 3453      | 3769      | 1128      | 4485          | **541**     |
| XXH3-64    | 1 MiB | 241       | 198       | **137**   | —             | —           |

Decisions taken from this table:

- Optimize SHA-1 and SHA-2 for speed (`opt-level = 3`). Size-optimized builds are 2–3 times slower for them.
- Optimize SHA-3, BLAKE and the other families for size (`opt-level = "s"`, `wasm-opt -O3`). Speed is the same and the
  module is smaller.
- The BLAKE3 numbers use the crate's scalar code. The `wasm32_simd` feature is expected to halve the 1 MiB time; the
  package benchmark will confirm it.
- `@noble/hashes` is 5–20 times slower than WASM for SHA-3 and BLAKE. It stays only as the fallback for hosts without
  WASM or with a CSP that forbids it.

## Packed versus raw WASM

Packing (deflate-raw, then text) makes modules 20–25% smaller before HTTP compression. The first load costs 25–177 ms
more, because the host must decode the text and run `DecompressionStream` before it compiles. After the first load, both
forms run the same code at the same speed. Item 4 of the list below repeats this per family and per browser.

Which text encoding to use. Measured on a 145 KB BLAKE module (30.3 KB after deflate), Deno 2.9:

| Form                        | Size     | After gzip -9 | After Brotli | Decode time           |
| --------------------------- | -------- | ------------- | ------------ | --------------------- |
| Raw `.wasm`                 | 144.8 KB | 30.3 KB       | **24.3 KB**  | none                  |
| Deflate + Z85               | 37.9 KB  | 31.0 KB       | 30.6 KB      | 1.97 ms (`@std/encoding`), 0.53 ms (table decoder) |
| Deflate + Base64            | 40.4 KB  | 30.9 KB       | 30.2 KB      | **0.02 ms** (`Uint8Array.fromBase64` or `atob`) |

Z85 saves 6% only when the server sends the JavaScript uncompressed. With HTTP compression it saves nothing, and its
decoder runs in JavaScript. So packed modules use Base64. A raw `.wasm` file served with Brotli is 20% smaller than any
packed form, which is the case for the `/wasm` entry point.

## Wide arithmetic

The same Rust source, built with `+simd128` and with `+simd128,+wide-arithmetic`. Throughput in GB/s. Results are
identical between builds.

| Function  | Input  | Bun plain | Bun wide  | Deno plain | Deno wide (flag) |
| --------- | ------ | --------- | --------- | ---------- | ---------------- |
| XXH3-64   | 64 B   | 2.49      | **4.20**  | 2.72       | **7.05**         |
| XXH3-64   | 1 KiB  | 11.9      | **14.0**  | 13.5       | **15.9**         |
| XXH3-64   | 1 MiB  | 15.5      | 15.3      | 18.8       | 18.6             |
| XXH3-128  | 64 B   | 2.25      | **4.08**  | 2.47       | **5.54**         |
| rapidhash | 64 B   | 2.27      | **4.34**  | 2.27       | **6.48**         |
| rapidhash | 1 KiB  | 4.84      | **22.8**  | 4.01       | **21.3**         |
| rapidhash | 1 MiB  | 4.98      | **31.5**  | 4.37       | **26.3**         |

Without the feature, WASM has no 64×64→128 multiply, so each 128-bit product becomes four 32-bit multiplies and
carries. rapidhash does one such product per 8 bytes, so it gains most. XXH3's long-input loop is SIMD and does not use
the wide multiply, so it gains only on short inputs. The wide module is also 15% smaller (10.3 KB against 12.1 KB).

## Host feature probes

Each probe is `WebAssembly.validate` on a minimal module, or a check for the function.

| Feature                         | Deno 2.9 | Node.js 22 | Bun 1.4 | Chrome 153 | Firefox | Safari |
| ------------------------------- | -------- | ---------- | ------- | ---------- | ------- | ------ |
| SIMD128                         | yes      | yes        | yes     | yes        | yes     | 16.4+  |
| Relaxed SIMD                    | yes      | yes        | yes     | yes        | 146+    | no     |
| Wide arithmetic                 | flag     | no         | yes     | flag       | 155+    | no     |
| Shared memory                   | yes      | yes        | yes     | isolated pages | isolated pages | isolated pages |
| `Uint8Array.fromBase64`, `toHex`| yes      | no         | yes     | 140+       | 133+    | 18.2+  |

Browser rows other than Chrome 153 come from caniuse and the browser vendors' release notes, not from a local run.

## The committed modules

Built by `mise run build -- --target wasm --write` from the crates in `packages/hash/wasm/`. Time per call in
microseconds on Node.js 22, through the package's own engine (window copy included).

| Family | Module   | Packed text | Algorithm   | 64 B | 1 MiB |
| ------ | -------- | ----------- | ----------- | ---- | ----- |
| sha2   | 39.4 KB  | 10.2 KB     | SHA-256     | 0.50 | 2359  |
|        |          |             | SHA-512     | 0.45 | 1760  |
| sha3   | 39.7 KB  | 12.5 KB     | SHA3-256    | 0.66 | 2567  |
|        |          |             | SHAKE128    | 0.61 | 2141  |
|        |          |             | KT128       | 0.49 | 1169  |
| blake  | 65.8 KB  | 25.7 KB     | BLAKE2b-512 | 0.45 | 995   |
|        |          |             | BLAKE2s-256 | 0.46 | 1585  |
|        |          |             | BLAKE3      | 0.33 | 571   |
| legacy | 113.2 KB | 48.7 KB     |             |      |       |
| national | 133.3 KB | 64.2 KB   |             |      |       |
| contest | 105.7 KB | 48.3 KB    |             |      |       |
| fsb    | 321.9 KB | 388.3 KB    |             |      |       |
| mac    | 14.8 KB  | 5.1 KB      |             |      |       |
| fast   | 32.6 KB  | 16.3 KB     |             |      |       |
| checksum | 48.5 KB | 46.1 KB    |             |      |       |

HMAC doubles a module: `contest` was 183 KB with HMAC for every algorithm and is 112 KB without. So families build
HMAC only where a standard or protocol uses it. FSB's packed text is larger than its module, because its 272 KB π table
does not compress and Base64 adds a third.

Two build findings:

- **SHA-3 needs a higher LLVM unroll threshold.** `keccak` 0.2 keeps its 24 rounds in a loop on stable Rust. With the
  default threshold SHA3-256 took 5.4 ms per MiB; with `-C llvm-args=-unroll-threshold=2000` it takes 2.6 ms, at the
  same size. The build applies the flag to the `sha3` family only, because it grows SHA-2 by 6 KB for no gain.
- **BLAKE3's WASM SIMD path halves its time**: 571 µs per MiB, against 1196 µs for the scalar prototype build.

Binaryen `-O3` and `-Oz` gave the same speed for every family once the unroll flag was scoped. SHA-2 keeps `-O3`;
SHA-3 and BLAKE use `-Oz`.

## Still to measure

1. Every committed module on Deno, Bun and Chrome, beside `node:crypto` and `@noble/hashes`.
2. `/shared` `many()` with 1, 2, 4 and 8 workers on 10 000 inputs of 1 KiB.
3. BLAKE3 subtree hashing across workers on one 64 MiB input.
4. First-load time of every family, packed and raw, in Chrome, Firefox and Safari.
5. Module size of every family after `wasm-opt`, raw and packed, with and without Brotli.
