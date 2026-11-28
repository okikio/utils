# Measurements behind the design

Status: evidence for the proposal in [Backends](01-backends.md). These numbers come from a prototype outside the
repository. The package benchmark (`pnpm --filter ./packages/hash --fail-if-no-match run bench`) will replace them when the WASM build lands.

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
the wide multiply, so it gains only on short inputs. In that experiment (rapidhash and XXH3 alone) the wide module was 15% smaller. The
shipped `fast` modules hold every fast hash: 31,238 bytes wide against 32,630 plain.

## Every family on every runtime

`packages/hash/families.bench.ts` times one or two algorithms of each family through the pinned entry points:
`/packed` for WebAssembly, `/native` and `/portable`. Run it with `deno run -A`, `node` or `bun`, adding `--json` for
the raw Mitata output; `--check` only verifies that every backend gives the same bytes. Throughput is in GB/s for Deno
2.9.8 / Node.js 22.23 / Bun 1.4.4 on a 2-core x86-64 sandbox, after the two fixes below. A dash means the backend
lacks the algorithm on that host (Bun's BoringSSL has no BLAKE2b).

| Algorithm | Backend | 64 B (D / N / B) | 4 KiB (D / N / B) | 1 MiB (D / N / B) |
| --------- | ------- | ---------------- | ----------------- | ----------------- |
| sha256 | wasm | 0.11 / 0.12 / 0.079 | 0.39 / 0.32 / 0.31 | 0.39 / 0.43 / 0.30 |
| sha256 | native | 0.023 / 0.043 / 0.12 | 0.78 / 1.13 / 1.49 | 1.71 / 1.85 / 1.81 |
| sha256 | portable | 0.020 / 0.042 / 0.050 | 0.18 / 0.18 / 0.19 | 0.22 / 0.19 / 0.20 |
| sha512 | wasm | 0.12 / 0.12 / 0.10 | 0.53 / 0.55 / 0.44 | 0.54 / 0.59 / 0.43 |
| sha512 | native | 0.025 / 0.039 / 0.068 | 0.50 / 0.63 / 0.54 | 0.73 / 0.80 / 0.66 |
| sha512 | portable | 0.010 / 0.021 / 0.031 | 0.089 / 0.080 / 0.087 | 0.099 / 0.098 / 0.096 |
| sha3-256 | wasm | 0.10 / 0.099 / 0.081 | 0.39 / 0.37 / 0.33 | 0.42 / 0.38 / 0.37 |
| sha3-256 | native | 0.022 / 0.036 / 0.087 | 0.21 / 0.42 / 0.36 | 0.31 / 0.53 / 0.44 |
| sha3-256 | portable | 0.013 / 0.011 / 0.018 | 0.043 / 0.023 / 0.047 | 0.051 / 0.026 / 0.049 |
| kt128 | wasm | 0.12 / 0.12 / 0.11 | 0.89 / 0.78 / 0.74 | 0.96 / 0.90 / 0.71 |
| kt128 | portable | 0.008 / 0.011 / 0.019 | 0.11 / 0.058 / 0.11 | 0.11 / 0.062 / 0.12 |
| blake3 | wasm | 0.18 / 0.16 / 0.12 | 1.54 / 1.54 / 0.59 | 1.76 / 1.74 / 0.60 |
| blake3 | portable | 0.014 / 0.024 / 0.036 | 0.059 / 0.060 / 0.22 | 0.061 / 0.057 / 0.20 |
| blake2b-512 | wasm | 0.14 / 0.13 / 0.088 | 0.94 / 0.97 / 0.54 | 1.01 / 0.99 / 0.54 |
| blake2b-512 | native | 0.025 / 0.040 / – | 0.58 / 0.77 / – | 1.06 / 1.07 / – |
| blake2b-512 | portable | 0.009 / 0.016 / 0.017 | 0.050 / 0.043 / 0.053 | 0.052 / 0.045 / 0.054 |
| md5 | wasm | 0.14 / 0.14 / 0.12 | 0.57 / 0.67 / 0.68 | 0.59 / 0.73 / 0.72 |
| md5 | native | 0.025 / 0.039 / 0.12 | 0.45 / 0.68 / 0.72 | 0.65 / 0.83 / 0.79 |
| md5 | portable | 0.019 / 0.027 / 0.038 | 0.11 / 0.084 / 0.10 | 0.11 / 0.088 / 0.11 |
| sha1 | wasm | 0.14 / 0.15 / 0.11 | 0.54 / 0.85 / 0.47 | 0.59 / 0.97 / 0.54 |
| sha1 | native | 0.025 / 0.048 / 0.12 | 0.77 / 1.23 / 1.64 | 1.71 / 1.99 / 1.90 |
| sha1 | portable | 0.027 / 0.037 / 0.057 | 0.25 / 0.21 / 0.22 | 0.33 / 0.23 / 0.23 |
| sm3 | wasm | 0.11 / 0.11 / 0.063 | 0.39 / 0.38 / 0.24 | 0.39 / 0.39 / 0.25 |
| streebog256 | wasm | 0.024 / 0.022 / 0.021 | 0.099 / 0.10 / 0.092 | 0.11 / 0.12 / 0.098 |
| skein512-512 | wasm | 0.037 / 0.045 / 0.035 | 0.15 / 0.17 / 0.12 | 0.16 / 0.17 / 0.12 |
| whirlpool | wasm | 0.049 / 0.053 / 0.039 | 0.13 / 0.14 / 0.10 | 0.12 / 0.15 / 0.11 |
| fsb256 | wasm | 0.007 / 0.009 / 0.007 | 0.006 / 0.008 / 0.007 | 0.006 / 0.008 / 0.006 |
| siphash-2-4 | wasm | 0.067 / 0.18 / 0.13 | 1.69 / 2.16 / 1.69 | 2.41 / 2.63 / 2.34 |
| xxh3-64 | wasm | 0.25 / 0.26 / 0.15 | 7.44 / 7.57 / 4.86 | 12.64 / 13.29 / 9.49 |
| rapidhash | wasm | 0.25 / 0.23 / 0.14 | 3.83 / 3.95 / 5.65 | 5.35 / 5.07 / 10.03 |
| CRC-32/ISO-HDLC | wasm | 0.27 / 0.26 / 0.15 | 1.77 / 2.15 / 1.77 | 1.91 / 2.60 / 2.03 |
| CRC-32/ISO-HDLC | portable | 0.064 / 0.27 / 0.050 | 1.14 / 0.93 / 1.11 | 1.44 / 1.02 / 1.60 |
| CRC-64/NVME | wasm | 0.16 / 0.18 / 0.11 | 0.37 / 0.41 / 0.36 | 0.37 / 0.42 / 0.37 |

What the table shows:

- **Short inputs cost a call, not hashing.** At 64 bytes every WASM hash runs at 0.1–0.27 GB/s, about 250–600 ns
  per call, whatever the algorithm. `node:crypto` costs more per call (`createHash`, a `Buffer`), which is why the
  automatic entry keeps SHA-1 and SHA-2 on WASM below 512 bytes.
- **`node:crypto` wins SHA-1 and SHA-256 from 4 KiB**, through the CPU's SHA instructions: 1.7–2.0 GB/s against
  0.4–0.6 for WASM. For SHA-512, MD5, SHA-3 and BLAKE2b the two are within about 30%; the automatic entry uses WASM
  for those.
- **Pure JavaScript is 3 to 30 times slower than WASM**, except the CRC-32 rewrite below. It exists for hosts that
  refuse WebAssembly, not for speed.
- **JavaScriptCore runs BLAKE3's SIMD path at a third of V8's speed** (0.6 against 1.75 GB/s). Bun gets the
  wide-arithmetic `fast` build, so rapidhash is twice as fast there (10 against 5 GB/s).
- **FSB is slow by design** (6–9 MB/s): each block is a syndrome computation over a large matrix. It is included for
  completeness, not for use.

### Fixes from this run

1. **Deno allocated each output for 800 ns.** Deno keeps every typed array's bytes off the JavaScript heap, so
   `new Uint8Array(32)` took about 800 ns, against 25 ns in Node.js and Bun, which keep arrays of up to 64 bytes on the
   heap. That allocation was most of a short call. Outputs of up to 64 bytes are now views into an 8 KiB slab
   (`_wasm/slab.ts`), as Node.js `Buffer` pools do. The family runtime also stopped copying the key on each call; every
   backend copies it anyway. A 64-byte SHA-256 call in Deno went from 1,838 to 547 ns, and keyed SipHash from about
   950 to 270 ns. The cost: a short output's `buffer` is shared and larger than the output, so `slice()` it before
   transferring its buffer.
2. **The portable CRC-32 was bitwise** (0.02 GB/s). It is now slicing-by-8 with tables built on first use: 1.0–1.6 GB/s
   at 1 MiB.
3. **CRC-32/ISO-HDLC uses `zlib.crc32` natively.** The built-in uses the carry-less multiply, which WebAssembly lacks.
   Per call, through the entry points (Deno 2.9.8 / Node.js 26.13.1 / Bun 1.4.4):

   | Input  | `zlib.crc32` (`/native`)    | WebAssembly (`/packed`)     |
   | ------ | --------------------------- | --------------------------- |
   | 64 B   | 960 / 1,137 / 439 ns        | 313 / 277 / 413 ns          |
   | 512 B  | 1,087 / 921 / 442 ns        | 550 / 427 / 646 ns          |
   | 4 KiB  | 3.67 / 2.67 / 8.13 GB/s     | 1.72 / 1.93 / 1.95 GB/s     |
   | 1 MiB  | 97.5 / 5.44 / 99.2 GB/s     | 1.86 / 2.14 / 2.25 GB/s     |

   A `zlib.crc32` call costs about 1 µs in Deno and Node, so the automatic entry uses it from 4 KiB there and from
   512 B on Bun, and keeps WebAssembly below that. Node.js 26 runs its `zlib.crc32` without the carry-less multiply,
   so it gains least. Incremental states (`create()`) always use it where it exists.

The same measurement for compiled Rust (single thread, AVX-512) showed where a native addon would help: BLAKE3 at
6.9 GB/s (WASM 1.7), XXH3 at 17.6 GB/s (WASM 13.3) and CRC-32 at 49 GB/s, while SHA-256 (already native through
`node:crypto`), SHA-3 and BLAKE2b gained 10% or less. That gain did not justify per-platform binaries, so the package
ships no Node-API addon; `zlib.crc32` gives CRC-32 most of it with no binary.

## Worker pool

Bun 1.4 on a 2-core sandbox. Throughput in GiB/s for the whole call; `thread` hashes on the calling thread.

| Input              | Algorithm | thread | 1 worker | 2 workers |
| ------------------ | --------- | ------ | -------- | --------- |
| 64 × 1 MiB         | BLAKE3    | 0.57   | 0.42     | 0.66      |
| 64 × 1 MiB         | SHA-256   | 1.16   | 0.73     | 1.10      |
| 1 × 64 MiB, split  | BLAKE3    | 0.59   |          | 0.73      |

One worker costs a copy into shared memory and the round trip, so it is slower than the calling thread. Two workers on
two cores, with the calling thread also copying, are at most 1.3 times faster here. The pool's value is on hosts with
more cores, and in keeping the calling thread free. Before batches became one buffer plus offsets, 20,000 inputs of
256 bytes took 97 ms on one worker against 71 ms on the calling thread; most of that was cloning 20,000 views.

## Host feature probes

Each probe is `WebAssembly.validate` on a minimal module, or a check for the function.

| Feature                         | Deno 2.9 | Node.js 22 | Bun 1.4 | Chrome 153 | Firefox | Safari |
| ------------------------------- | -------- | ---------- | ------- | ---------- | ------- | ------ |
| SIMD128                         | yes      | yes        | yes     | yes        | yes     | 16.4+  |
| Relaxed SIMD                    | yes      | yes        | yes     | yes        | 146+    | no     |
| Wide arithmetic                 | flag     | no         | yes     | flag       | 155+    | no (WebKit 27.2: yes) |
| Shared memory                   | yes      | yes        | yes     | isolated pages | isolated pages | isolated pages |
| `Uint8Array.fromBase64`, `toHex`| yes      | no         | yes     | 140+       | 133+    | 18.2+  |

Browser rows other than Chrome 153 come from caniuse and the browser vendors' release notes, not from a local run.

## The committed modules

Built by `mise run build:wasm -- --write` from the crates in `packages/hash/wasm/`. Time per call in
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

## Browsers

Chromium 158, Firefox 159 and WebKit 27.2 (Playwright builds, headless, same 2-core sandbox), through the package's
engine. The page and its runner are kept out of the repository; they bundle `_wasm/load.ts` with `deno bundle` and
serve the raw modules as `application/wasm`.

First load in milliseconds, once per page: decode and compile the packed text, then fetch and compile the raw file.

| Family   | Chromium packed / raw | Firefox packed / raw | WebKit packed / raw |
| -------- | --------------------- | -------------------- | ------------------- |
| sha2     | 4.0 / 7.4             | 4.0 / 40.0           | 9.0 / 27.0          |
| sha3     | 9.1 / 5.5             | 2.0 / 69.0           | 4.0 / 6.0           |
| blake    | 2.0 / 2.9             | 4.0 / 28.0           | 3.0 / 9.0           |
| legacy   | 1.6 / 3.4             | 8.0 / 23.0           | 6.0 / 4.0           |
| national | 2.1 / 3.6             | 5.0 / 22.0           | 3.0 / 6.0           |
| contest  | 1.9 / 3.0             | 5.0 / 28.0           | 3.0 / 10.0          |
| fsb      | 3.1 / 5.6             | 3.0 / 19.0           | 6.0 / 7.0           |
| mac      | 1.0 / 2.7             | 2.0 / 20.0           | 5.0 / 5.0           |
| fast     | 1.2 / 4.6             | 2.0 / 31.0           | 3.0 / 3.0           |
| checksum | 1.2 / 2.8             | 0.0 / 169.0          | 5.0 / 3.0           |

Firefox and WebKit report whole milliseconds. Packed loading needs no request, so it is the faster first load in every
browser; in Firefox each raw fetch from `localhost` cost 20–170 ms. This supports packed WASM as the default. A raw
file can still win on a real site where it is cached and compiled in the background.

Throughput in GB/s at 64 B / 4 KiB / 1 MiB:

| Algorithm       | Chromium             | Firefox              | WebKit               |
| --------------- | -------------------- | -------------------- | -------------------- |
| sha256          | 0.12 / 0.39 / 0.30   | 0.093 / 0.39 / 0.40  | 0.095 / 0.33 / 0.33  |
| sha512          | 0.13 / 0.55 / 0.58   | 0.077 / 0.45 / 0.54  | 0.12 / 0.39 / 0.47   |
| sha3-256        | 0.13 / 0.41 / 0.41   | 0.084 / 0.32 / 0.26  | 0.11 / 0.34 / 0.38   |
| blake3          | 0.22 / 1.53 / 1.74   | 0.16 / 1.54 / 1.83   | 0.17 / 0.63 / 0.64   |
| md5             | 0.16 / 0.57 / 0.58   | 0.13 / 0.58 / 0.61   | 0.19 / 0.70 / 0.73   |
| xxh3-64         | 0.35 / 8.60 / 13.00  | 0.22 / 7.05 / 11.35  | 0.39 / 9.06 / 10.22  |
| rapidhash       | 0.29 / 4.05 / 3.67   | 0.20 / 6.76 / 12.97  | 0.37 / 11.75 / 16.85 |
| CRC-32/ISO-HDLC | 0.28 / 1.93 / 2.36   | 0.19 / 1.88 / 2.24   | 0.44 / 2.16 / 2.29   |

Firefox and WebKit validate the wide-arithmetic probe, so they ran the wide `fast` build: rapidhash is 3.5 to 4.6
times faster there than in Chromium. Playwright's WebKit is newer than shipping Safari, so this does not show which
Safari release has the feature. JavaScriptCore again runs BLAKE3's SIMD path at about a third of V8 and SpiderMonkey.

## Worker pool scaling

10,000 inputs of 1 KiB, BLAKE3, Bun, best of three, in ms: calling thread 53.1; 1 worker 43.9; 2 workers 40.7;
4 workers 48.8; 8 workers 33.6. With two cores, more workers than cores only add scheduling noise. The calling thread
figure includes warm-up, so it is an upper bound. The useful result is that 10,000 small inputs cost about the same on
a worker as on the calling thread, so moving them off the calling thread is nearly free.

## Module sizes with HTTP compression

Brotli at quality 11. A raw module served with Brotli is smaller than the packed text, because the text is already
deflated and Base64 adds a third. But the packed text is part of the JavaScript, so it costs no extra request.

| Family    | Raw      | Raw, Brotli | Packed text | Packed text, Brotli |
| --------- | -------- | ----------- | ----------- | ------------------- |
| sha2      | 39.5 KB  | 6.2 KB      | 10.5 KB     | 7.9 KB              |
| sha3      | 42.6 KB  | 7.8 KB      | 13.6 KB     | 10.2 KB             |
| blake     | 69.7 KB  | 16.7 KB     | 28.2 KB     | 21.2 KB             |
| legacy    | 113.7 KB | 28.8 KB     | 48.3 KB     | 36.2 KB             |
| national  | 132.8 KB | 40.9 KB     | 64.9 KB     | 48.6 KB             |
| contest   | 105.8 KB | 24.9 KB     | 48.7 KB     | 34.0 KB             |
| fsb       | 321.9 KB | 284.1 KB    | 388.5 KB    | 289.9 KB            |
| mac       | 14.8 KB  | 3.3 KB      | 5.3 KB      | 4.0 KB              |
| fast      | 32.6 KB  | 10.3 KB     | 16.4 KB     | 12.3 KB             |
| fast-wide | 31.2 KB  | 9.7 KB      | 15.2 KB     | 11.4 KB             |
| checksum  | 48.5 KB  | 32.6 KB     | 46.1 KB     | 34.6 KB             |
