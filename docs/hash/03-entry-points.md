# Entry points

Status: proposed. Read [Backends](01-backends.md) first.

An import path selects two things: which algorithms you can call (the **family**) and how they run (the **backend**).
Most code imports a family and lets the default choose the backend.

```ts
import { sha3_256 } from '@okikio/hash/sha3';

console.log(await sha3_256('hello'));
```

## Family entry points

Each family path exports the family's algorithms, their HMAC forms and `ready()`.

| Path                         | Family                                        |
| ---------------------------- | --------------------------------------------- |
| `@okikio/hash`            | `sha2`, `id`, `hex` (no change from today)    |
| `@okikio/hash/sha2`       | SHA-2                                         |
| `@okikio/hash/sha3`       | SHA-3, Keccak, SHAKE, cSHAKE, TurboSHAKE, K12, KMAC |
| `@okikio/hash/blake`      | BLAKE2, BLAKE3                                |
| `@okikio/hash/legacy`     | MD2, MD4, MD5, SHA-1, SHA-1 checked, RIPEMD, Tiger |
| `@okikio/hash/national`   | Streebog, GOST94, SM3, Kupyna, BelT, bash, Ascon |
| `@okikio/hash/contest`    | Grøstl, JH, Skein, Shabal, CubeHash, Whirlpool, FSB |
| `@okikio/hash/mac`        | Poly1305, POLYVAL, GHASH, SipHash, HighwayHash |
| `@okikio/hash/fast`       | xxHash, rapidhash, wyhash, MurmurHash3, MetroHash, CityHash, SeaHash, FNV |
| `@okikio/hash/checksum`   | CRC catalogue, Adler-32, Fletcher             |
| `@okikio/hash/digest`     | `digest(name, input)` for any family; loads the family on first use |

`digest` with a name string must be able to reach every family, so it loads families with dynamic `import()`. A
bundler then emits one chunk per family. Prefer a family path when you know the algorithm at build time.

## Backend entry points

Add a backend after the family to force it. The default is the automatic choice.

| Suffix       | Example                              | Behavior                                                   |
| ------------ | ------------------------------------ | ---------------------------------------------------------- |
| (none)       | `@okikio/hash/sha3`               | Automatic choice ([rules](01-backends.md#how-the-default-chooses)) |
| `/packed`    | `@okikio/hash/sha3/packed`        | Embedded WASM only                                          |
| `/wasm`      | `@okikio/hash/sha3/wasm`          | Separate `.wasm` file only; `ready({ url })` can override the file location |
| `/native`    | `@okikio/hash/sha2/native`        | `node:crypto` only; throws `UnsupportedError` without it    |
| `/web`       | `@okikio/hash/sha2/web`           | Web Crypto only; asynchronous functions only               |
| `/portable`  | `@okikio/hash/sha3/portable`      | Pure JavaScript only; exports only what `@noble/hashes` has |
| `/shared`    | `@okikio/hash/blake/shared`       | WASM with shared memory and a worker pool; see below       |

A forced backend never falls back. That is the point of forcing it: a test or an audit can prove which code ran.

`/native`, `/web` and `/portable` exist only for families that have an implementation in that backend. The
[algorithm tables](02-algorithms.md) show which.

## Encoding entry points

Encodings are not hashes, but hash results are often encoded. Each has its own path, so a page that only needs Base64
does not load anything else.

| Path                        | Exports                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `@okikio/hash/base64`    | `base64`, `unbase64`, `base64url`, `unbase64url`               |
| `@okikio/hash/hex`       | `hex`, `unhex`                                                  |
| `@okikio/hash/encoding`  | All of the above (no change from today)                        |

These use `Uint8Array.prototype.toBase64`, `Uint8Array.fromBase64`, `toHex` and `fromHex` when the host has them
(Chrome 140+, Firefox 133+, Safari 18.2+, Deno, Bun). Node.js 22 does not, so they fall back to `@std/encoding`. Both
paths enforce the same strict rules as today: canonical padding, no whitespace, no mixed alphabets.

## Shared memory and workers

`/shared` builds the family with WASM threads: the module imports a `WebAssembly.Memory` created with `shared: true`,
whose buffer is a `SharedArrayBuffer`. Each worker instantiates the same module on the same memory and owns one input
slot and one state slot.

```ts
import { pool } from '@okikio/hash/blake/shared';

await using hashes = await pool({ workers: 4 });
const digests = await hashes.many('blake3', files); // one digest per input, in order
```

What it speeds up:

- **Many independent inputs.** `many()` spreads inputs across workers. Throughput grows with the number of cores until
  memory bandwidth is the limit.
- **One large BLAKE3 or KangarooTwelve input.** Both are tree hashes. Workers hash separate subtrees with the official
  `blake3::hazmat` API and the `k12` crate, and one worker merges the results. The digest is the same as the
  sequential one.
- **Inputs already in a `SharedArrayBuffer`.** A view on WASM shared memory is hashed without a copy.

What it does not speed up: one input of a sequential hash (SHA-2, SHA-3 without trees, MD5). Each block depends on the
one before it. `many()` still helps when you have several.

Requirements: browsers expose `SharedArrayBuffer` only to pages that are cross-origin isolated (`Cross-Origin-Opener-Policy:
same-origin` and `Cross-Origin-Embedder-Policy: require-corp`). `pool()` checks `crossOriginIsolated` and throws
`UnsupportedError` with that explanation when it is false. Node.js, Deno and Bun always allow it.

## Wide-arithmetic builds

The WASM [wide-arithmetic](https://github.com/WebAssembly/wide-arithmetic) feature adds 64×64→128-bit multiply and
128-bit add instructions. xxHash, rapidhash, wyhash and MurmurHash3 use 128-bit multiplies. [Measurements](04-measurements.md#wide-arithmetic)
show rapidhash 5–7 times faster on large inputs and XXH3 up to 2.6 times faster on 64-byte inputs.

Firefox 155 and Bun ship the feature. V8 (Chrome, Node.js, Deno) has it behind a flag. Safari does not have it. So the
`fast` family ships two modules. The loader calls `WebAssembly.validate` on a 34-byte probe module once and picks the
wide module only when the host accepts it. Both modules give the same results.

Other families do not benefit, so they ship one module.

## Features the package does not use

| WASM or JS feature       | Why not                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| Relaxed SIMD             | The hash crates do not emit relaxed instructions, and Safari does not support it. |
| memory64                 | Inputs are streamed through a 64 KiB window. 64-bit addresses only add bounds-check cost. |
| Multiple memories        | One memory is enough. Rust does not target multiple memories.                    |
| JS string builtins       | Would let WASM read a JS string without `TextEncoder`. Stable Rust cannot import `externref` builtins without `wasm-bindgen`, and `encodeInto` already runs at memory speed. |
| Source phase imports (`import source m from './x.wasm'`) | The best way to load `/wasm` in future. Today Node.js needs a flag and Firefox does not support it. The `/wasm` loader will adopt it when all target hosts ship it. |
